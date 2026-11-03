// Turns the signal and your inputs into one instruction. Pure function: no network, no storage.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Logic = factory();
})(this, function () {
  var FUNDS = ["NASD11", "CHIP11"];
  var SLIP = 0.005; // suggested limit: 0.5% over the last close
  var MAX_FEE_SHARE = 0.01; // add money only if the fee is 1% of the purchase or less

  function num(x) {
    var n = Number(x);
    return isFinite(n) && n > 0 ? n : 0;
  }
  function round2(x) {
    return Math.round(x * 100) / 100;
  }

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
    if (!target) return { action: "OUT", fee: fee };

    var price = signal.prices && signal.prices[target] ? num(signal.prices[target].close) : 0;
    if (!price) return { action: "NO_PRICE", fund: target };

    var limit = round2(price * (1 + SLIP));
    // Whole cents, so an exact amount can't lose a share to floating-point rounding.
    var shares = Math.max(0, Math.floor(Math.round((cash - fee) * 100) / Math.round(limit * 100)));
    var cost = round2(shares * limit);
    var order = {
      fund: target, shares: shares, limit: limit, lastClose: price, fee: fee, cost: cost,
      total: round2(cost + fee), left: round2(cash - cost - fee),
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

  // Inputs after the instruction was carried out. Buys assume a fill at the limit, the most it can cost;
  // sales assume the last close. Either way the person can correct the cash to the real figure.
  function applyOrder(signal, inputs, d) {
    var next = { cash: num(inputs.cash), NASD11: Math.floor(num(inputs.NASD11)), CHIP11: Math.floor(num(inputs.CHIP11)), fee: inputs.fee };
    if (d.action === "BUY" || d.action === "ADD") {
      next[d.fund] += d.shares;
      next.cash = Math.max(0, round2(next.cash - d.total));
    } else if (d.action === "SELL") {
      var p = signal.prices && signal.prices[d.fund] ? num(signal.prices[d.fund].close) : 0;
      next[d.fund] = 0;
      next.cash = Math.max(0, round2(next.cash + d.shares * p - d.fee));
    } else {
      return null;
    }
    return next;
  }

  function ageDays(signalDate, now) {
    return Math.floor((now - new Date(signalDate + "T00:00:00Z")) / 86400000);
  }

  return { decide: decide, applyOrder: applyOrder, ageDays: ageDays, FUNDS: FUNDS };
});
