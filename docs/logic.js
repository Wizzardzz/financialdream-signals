// Turns the signal and your portfolio into one instruction. Pure functions: no network, no storage.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Logic = factory();
})(this, function () {
  var FUNDS = ["NASD11", "CHIP11"];
  var SLIP = 0.005; // suggested limit: 0.5% over the last close
  var MAX_FEE_SHARE = 0.01; // add money only if the fee is 1% of the purchase or less
  var TAX = 0.15; // assumed tax on gains

  function num(x) {
    var n = Number(x);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function round2(x) {
    return Math.round(x * 100) / 100;
  }
  function closeOf(signal, f) {
    return signal.prices && signal.prices[f] ? num(signal.prices[f].close) : 0;
  }

  // Works out the order from cash and share counts.
  function decide(signal, inputs) {
    var cash = num(inputs.cash);
    var fee = num(inputs.fee);
    var held = { NASD11: Math.floor(num(inputs.NASD11)), CHIP11: Math.floor(num(inputs.CHIP11)) };
    var target = signal.target;

    for (var i = 0; i < FUNDS.length; i++) {
      var f = FUNDS[i];
      if (held[f] > 0 && f !== target) {
        return { action: "SELL", fund: f, shares: held[f], fee: fee, thenBuy: target || null };
      }
    }
    if (!target) return { action: "OUT", fee: fee, cash: cash };

    var price = closeOf(signal, target);
    if (!price) return { action: "NO_PRICE", fund: target };

    var limit = round2(price * (1 + SLIP));
    // Whole cents, so an exact amount can't lose a share to floating-point rounding.
    var shares = Math.max(0, Math.floor(Math.round((cash - fee) * 100) / Math.round(limit * 100)));
    var cost = round2(shares * limit);
    var order = {
      fund: target, shares: shares, limit: limit, lastClose: price, fee: fee, cost: cost,
      total: round2(cost + fee), left: round2(cash - cost - fee), cash: cash,
      feeShare: cost > 0 ? fee / cost : 0,
    };

    if (held[target] === 0) {
      if (shares < 1) {
        order.action = "CANT_AFFORD";
        order.needed = round2(limit + fee);
        return order;
      }
      order.action = "BUY";
      return order;
    }

    var minPurchase = round2(fee / MAX_FEE_SHARE);
    if (shares >= 1 && cost >= minPurchase) {
      order.action = "ADD";
      return order;
    }
    return {
      action: "HOLD", fund: target, held: held[target], cash: cash, fee: fee,
      waitUntil: cash > 0 && fee > 0 ? round2(Math.ceil(minPurchase / limit) * limit + fee) : null,
    };
  }

  // Spent is shares x average price. Whatever is left of the allocated money is uninvested cash.
  function portfolio(signal, state) {
    var allocated = num(state.allocated);
    var spent = 0, value = 0, missingAvg = null, funds = {};
    FUNDS.forEach(function (f) {
      var s = state[f] || {};
      var shares = Math.floor(num(s.shares));
      var avg = num(s.avg);
      var cost = round2(shares * avg);
      var close = closeOf(signal, f);
      var val = round2(shares * close);
      if (shares > 0 && !avg && !missingAvg) missingAvg = f;
      funds[f] = {
        shares: shares, avg: avg, cost: cost, close: close, value: val,
        gain: shares > 0 && avg ? round2(val - cost) : null,
        gainPct: shares > 0 && avg && cost > 0 ? val / cost - 1 : null,
      };
      spent += cost;
      value += val;
    });
    spent = round2(spent);
    return {
      allocated: allocated, spent: spent, cash: Math.max(0, round2(allocated - spent)),
      over: spent > allocated ? round2(spent - allocated) : 0,
      value: round2(value), funds: funds, missingAvg: missingAvg, fee: num(state.fee),
    };
  }

  // The instruction for this portfolio. A sell is never held back by missing details.
  function recommend(signal, state) {
    var p = portfolio(signal, state);
    var d = decide(signal, { cash: p.cash, NASD11: p.funds.NASD11.shares, CHIP11: p.funds.CHIP11.shares, fee: p.fee });
    if (d.action === "SELL") {
      var fund = p.funds[d.fund];
      var proceeds = round2(d.shares * fund.close - d.fee);
      d.lastClose = fund.close;
      d.proceeds = proceeds;
      if (fund.avg) {
        d.gain = round2(proceeds - fund.cost);
        d.tax = d.gain > 0 ? round2(d.gain * TAX) : 0;
      }
      return d;
    }
    if (d.action === "OUT") return d;
    if (p.missingAvg) return { action: "NEED_AVG", fund: p.missingAvg };
    if (!p.allocated) return { action: "NEED_ALLOCATED" };
    return d;
  }

  // What to do with each of the three options: the fund the rule holds, the other fund, and CDI.
  function options(signal, state, d) {
    var p = portfolio(signal, state);
    var out = {};
    FUNDS.forEach(function (f) {
      var isTarget = f === signal.target;
      var shares = p.funds[f].shares;
      if (d.action === "SELL" && d.fund === f) out[f] = "Sell all " + d.shares;
      else if (isTarget && (d.action === "BUY" || d.action === "ADD")) out[f] = "Buy " + d.shares;
      else if (isTarget && d.action === "SELL") out[f] = "Buy after the sale";
      else if (isTarget) out[f] = shares > 0 ? "Hold " + shares : "Buy when you have the cash";
      else out[f] = shares > 0 ? "Hold " + shares + " for now" : "Don't buy";
    });
    if (d.action === "BUY" || d.action === "ADD") out.CDI = d.left;
    else if (d.action === "SELL") out.CDI = round2(p.cash + d.proceeds);
    else out.CDI = p.cash;
    return out;
  }

  // Portfolio after the instruction was carried out. Buys assume a fill at the limit and add the fee to the
  // average price, so spent includes costs. A sale at the last close moves its gain or loss into the allocated
  // money, so the whole proceeds become uninvested cash. The person can correct any figure afterwards.
  function applyOrder(signal, state, d) {
    var p = portfolio(signal, state);
    var next = { allocated: p.allocated, fee: state.fee };
    FUNDS.forEach(function (f) { next[f] = { shares: p.funds[f].shares, avg: p.funds[f].avg }; });
    if (d.action === "BUY" || d.action === "ADD") {
      var n = next[d.fund].shares + d.shares;
      next[d.fund] = { shares: n, avg: Math.round(((p.funds[d.fund].cost + d.total) / n) * 10000) / 10000 };
    } else if (d.action === "SELL") {
      if (typeof d.gain === "number") next.allocated = Math.max(0, round2(p.allocated + d.gain));
      else next.allocated = round2(p.allocated + d.proceeds);
      next[d.fund] = { shares: 0, avg: 0 };
    } else {
      return null;
    }
    return next;
  }

  function ageDays(signalDate, now) {
    return Math.floor((now - new Date(signalDate + "T00:00:00Z")) / 86400000);
  }

  return { decide: decide, portfolio: portfolio, recommend: recommend, options: options, applyOrder: applyOrder, ageDays: ageDays, FUNDS: FUNDS };
});
