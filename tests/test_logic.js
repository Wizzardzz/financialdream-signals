// Run with: node tests/test_logic.js
const assert = require("assert");
const { decide, ageDays } = require("../docs/logic.js");

const P = { NASD11: { close: 21.5 }, CHIP11: { close: 35 } };
const on = { target: "CHIP11", prices: P };
const off = { target: null, prices: P };
const i = (cash, n, c, fee = 4.5) => ({ cash, NASD11: n, CHIP11: c, fee });
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok  " + name); };

t("R$500 buys 14 at a R$35.17 limit", () => {
  const d = decide(on, i(500, 0, 0));
  assert.equal(d.action, "BUY"); assert.equal(d.shares, 14); assert.equal(d.limit, 35.17);
  assert.equal(d.total, 496.88); assert.equal(d.left, 3.12);
  assert.ok(d.left >= 0);
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
t("enough extra cash adds, with the fee at 1% or less", () => {
  const d = decide(on, i(600, 0, 14));
  assert.equal(d.action, "ADD"); assert.ok(d.feeShare <= 0.01, String(d.feeShare));
});
t("zero fee adds any whole share", () => {
  assert.equal(decide(on, i(40, 0, 14, 0)).action, "ADD");
  assert.equal(decide(on, i(30, 0, 14, 0)).action, "HOLD");
});
t("trend off: sell everything", () => {
  const d = decide(off, i(3, 0, 14));
  assert.equal(d.action, "SELL"); assert.equal(d.fund, "CHIP11"); assert.equal(d.shares, 14); assert.equal(d.thenBuy, null);
});
t("trend off and flat: stay out", () => assert.equal(decide(off, i(500, 0, 0)).action, "OUT"));
t("leader switch sells first, whatever the cash", () => {
  const d = decide(on, i(5000, 20, 0));
  assert.equal(d.action, "SELL"); assert.equal(d.fund, "NASD11"); assert.equal(d.thenBuy, "CHIP11");
});
t("after the sale it buys the new fund", () => assert.equal(decide(on, i(500, 0, 0)).action, "BUY"));
t("both funds held: sells the wrong one, keeps the right one", () => assert.equal(decide(on, i(0, 5, 5)).fund, "NASD11"));
t("missing price never produces an order", () => assert.equal(decide({ target: "CHIP11", prices: {} }, i(500, 0, 0)).action, "NO_PRICE"));
t("bad inputs count as zero", () => {
  assert.equal(decide(on, { cash: "abc", NASD11: "", CHIP11: -3, fee: "" }).action, "CANT_AFFORD");
});
t("part shares are ignored", () => assert.equal(decide(off, i(0, 0, 2.9)).shares, 2));
t("signal age", () => assert.equal(ageDays("2026-10-30", new Date("2026-11-10T12:00:00Z")), 11));
console.log(`${n} passed`);
