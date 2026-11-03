// Run with: node tests/test_logic.js
const assert = require("assert");
const { decide, portfolio, recommend, options, applyOrder, ageDays } = require("../docs/logic.js");

const P = { NASD11: { close: 21.5 }, CHIP11: { close: 35 } };
const on = { target: "CHIP11", prices: P };
const off = { target: null, prices: P };
const i = (cash, n, c, fee = 4.5) => ({ cash, NASD11: n, CHIP11: c, fee });
// Portfolio shorthand: allocated, CHIP11 shares and average, NASD11 shares and average.
const s = (allocated, cs = 0, ca = 0, ns = 0, na = 0, fee = 4.5) => ({
  allocated, fee, CHIP11: { shares: cs, avg: ca }, NASD11: { shares: ns, avg: na },
});
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

// ---- orders from cash and share counts
t("R$500 buys 14 at a R$35.17 limit", () => {
  const d = decide(on, i(500, 0, 0));
  assert.equal(d.action, "BUY"); assert.equal(d.shares, 14); assert.equal(d.limit, 35.17);
  assert.equal(d.total, 496.88); assert.equal(d.left, 3.12);
});
t("R$20 cannot buy a share, and says what is needed", () => {
  const d = decide(on, i(20, 0, 0));
  assert.equal(d.action, "CANT_AFFORD"); assert.equal(d.needed, 39.67);
});
t("cash just below one share plus fee is refused", () => assert.equal(decide(on, i(39.66, 0, 0)).action, "CANT_AFFORD"));
t("cash exactly one share plus fee buys one", () => assert.equal(decide(on, i(39.67, 0, 0)).shares, 1));
t("holding the right fund with no cash: HOLD", () => assert.equal(decide(on, i(0, 0, 14)).action, "HOLD"));
t("price drift never trades", () => {
  const up = { target: "CHIP11", prices: { CHIP11: { close: 70 }, NASD11: { close: 21.5 } } };
  assert.equal(decide(up, i(2.98, 0, 14)).action, "HOLD");
});
t("small extra cash waits, with a target to reach", () => {
  const d = decide(on, i(200, 0, 14));
  assert.equal(d.action, "HOLD");
  assert.equal(d.waitUntil, 461.71); // 13 shares at R$35.17, plus the fee
  assert.equal(decide(on, i(d.waitUntil, 0, 14)).action, "ADD");
  assert.equal(decide(on, i(d.waitUntil - 0.01, 0, 14)).action, "HOLD");
});
t("zero fee adds any whole share", () => {
  assert.equal(decide(on, i(40, 0, 14, 0)).action, "ADD");
  assert.equal(decide(on, i(30, 0, 14, 0)).action, "HOLD");
});
t("part shares are ignored", () => assert.equal(decide(off, i(0, 0, 2.9)).shares, 2));

// ---- portfolio arithmetic
t("spent is shares x average, and the rest of the allocated money is cash", () => {
  const p = portfolio(on, s(500, 13, 35.42));
  assert.equal(p.spent, 460.46); assert.equal(p.cash, 39.54); assert.equal(p.over, 0);
  assert.equal(p.funds.CHIP11.value, 455);
  assert.equal(p.funds.CHIP11.gain, -5.46);
});
t("both funds count toward spent", () => assert.equal(portfolio(on, s(1000, 10, 30, 10, 20)).spent, 500));
t("spending over the allocated money gives zero cash and a warning figure", () => {
  const p = portfolio(on, s(100, 13, 35));
  assert.equal(p.cash, 0); assert.equal(p.over, 355);
});
t("empty and bad inputs count as zero", () => {
  const p = portfolio(on, { allocated: "abc", fee: "", CHIP11: { shares: "", avg: -3 }, NASD11: {} });
  assert.equal(p.allocated, 0); assert.equal(p.spent, 0); assert.equal(p.missingAvg, null);
});

// ---- recommendations
t("the reported case: 13 held at a real average, R$500 allocated, says hold", () => {
  const d = recommend(on, s(500, 13, 35.42));
  assert.equal(d.action, "HOLD"); assert.equal(d.held, 13); assert.equal(d.cash, 39.54);
});
t("raising the allocated money enough turns hold into add", () => {
  const d = recommend(on, s(1000, 13, 35.42));
  assert.equal(d.action, "ADD"); assert.equal(d.cash, 539.54); assert.equal(d.shares, 15);
});
t("nothing entered asks for the money, not 'not enough cash'", () => assert.equal(recommend(on, s("")).action, "NEED_ALLOCATED"));
t("shares without an average ask for it", () => {
  const d = recommend(on, s(500, 13, ""));
  assert.equal(d.action, "NEED_AVG"); assert.equal(d.fund, "CHIP11");
});
t("shares without allocated money ask for it", () => assert.equal(recommend(on, s("", 13, 35)).action, "NEED_ALLOCATED"));
t("a sell is never held back by missing details", () => {
  const d = recommend(off, s("", 14, ""));
  assert.equal(d.action, "SELL"); assert.equal(d.shares, 14);
  assert.equal(d.proceeds, 485.5); assert.equal(d.gain, undefined);
});
t("trend off and flat: stay out, whatever is entered", () => assert.equal(recommend(off, s("")).action, "OUT"));
t("a sale shows gain and estimated tax", () => {
  const d = recommend(off, s(500, 14, 25));
  assert.equal(d.proceeds, 485.5); assert.equal(d.gain, 135.5); assert.equal(d.tax, 20.33);
});
t("a sale at a loss owes no tax", () => assert.equal(recommend(off, s(500, 14, 40)).tax, 0));
t("leader switch sells first, whatever the cash", () => {
  const d = recommend(on, s(5000, 0, 0, 20, 20));
  assert.equal(d.action, "SELL"); assert.equal(d.fund, "NASD11"); assert.equal(d.thenBuy, "CHIP11");
});
t("missing price never produces an order", () => {
  assert.equal(recommend({ target: "CHIP11", prices: {} }, s(500)).action, "NO_PRICE");
});

// ---- the three options
t("options when buying", () => {
  const st = s(500);
  const o = options(on, st, recommend(on, st));
  assert.deepEqual(o, { NASD11: "Don't buy", CHIP11: "Buy 14", CDI: 3.12 });
});
t("options when holding", () => {
  const st = s(500, 13, 35.42);
  const o = options(on, st, recommend(on, st));
  assert.deepEqual(o, { NASD11: "Don't buy", CHIP11: "Hold 13", CDI: 39.54 });
});
t("options when the leader switched", () => {
  const st = s(500, 0, 0, 20, 20);
  const o = options(on, st, recommend(on, st));
  assert.equal(o.NASD11, "Sell all 20"); assert.equal(o.CHIP11, "Buy after the sale");
  assert.equal(o.CDI, 100 + 430 - 4.5);
});
t("options when out", () => {
  const st = s(500);
  const o = options(off, st, recommend(off, st));
  assert.deepEqual(o, { NASD11: "Don't buy", CHIP11: "Don't buy", CDI: 500 });
});

// ---- recording an order
const after = (sig, st) => { const d = recommend(sig, st); return { d, next: applyOrder(sig, st, d) }; };
t("a buy sets shares and an average that includes the fee, and leaves the allocated money alone", () => {
  const { next } = after(on, s(500));
  assert.equal(next.CHIP11.shares, 14);
  assert.equal(next.CHIP11.avg, Math.round((496.88 / 14) * 10000) / 10000);
  assert.equal(next.allocated, 500);
  const p = portfolio(on, next);
  assert.ok(Math.abs(p.cash - 3.12) < 0.02, String(p.cash));
  assert.equal(recommend(on, next).action, "HOLD");
});
t("adding more moves the average toward the new price", () => {
  const { next } = after(on, s(1000, 13, 30));
  assert.equal(next.CHIP11.shares, 13 + 17); // R$610 left, less the fee, at a R$35.17 limit
  assert.ok(next.CHIP11.avg > 30 && next.CHIP11.avg < 35.17, String(next.CHIP11.avg));
  assert.equal(recommend(on, next).action, "HOLD");
});
t("a sale clears the shares, and the gain joins the allocated money so the proceeds become cash", () => {
  const { next } = after(off, s(500, 14, 25));
  assert.equal(next.CHIP11.shares, 0);
  assert.equal(next.allocated, 635.5);
  const p = portfolio(off, next);
  assert.equal(p.spent, 0); assert.equal(p.cash, 635.5);
  assert.equal(recommend(off, next).action, "OUT");
});
t("a sale at a loss lowers the allocated money", () => {
  const { next } = after(off, s(500, 14, 40));
  assert.equal(next.allocated, 500 - 560 + 485.5);
});
t("a leader switch goes sell, confirm, buy, confirm, hold", () => {
  const a = after(on, s(430, 0, 0, 20, 20));
  assert.equal(a.d.action, "SELL");
  const b = after(on, a.next);
  assert.equal(b.d.action, "BUY"); assert.equal(b.d.fund, "CHIP11");
  assert.equal(recommend(on, b.next).action, "HOLD");
});
t("nothing to record when no order is shown", () => {
  const st = s(500, 14, 35);
  assert.equal(applyOrder(on, st, recommend(on, st)), null);
});
t("signal age", () => assert.equal(ageDays("2026-10-30", new Date("2026-11-10T12:00:00Z")), 11));
console.log(`${n} passed`);
