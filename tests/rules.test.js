import test from "node:test";
import assert from "node:assert/strict";
import {
  refundQuote,
  canDispatch,
  deliveryBalance,
  balanced,
  cents,
} from "../src/shared/rules.js";
test("retains 25% of total, not 25% of deposit", () => {
  assert.deepEqual(
    refundQuote({ totalCents: 1000000, paidCents: 500000, hasShipped: true }),
    { retainedCents: 250000, refundCents: 250000 },
  );
  assert.equal(
    refundQuote({ totalCents: 1000000, paidCents: 1000000, hasShipped: true })
      .refundCents,
    750000,
  );
});
test("pre-dispatch full refund and exact return deadline", () => {
  assert.equal(
    refundQuote({ totalCents: 1000000, paidCents: 500000, hasShipped: false })
      .refundCents,
    500000,
  );
  const p = {
    totalCents: 1000000,
    paidCents: 1000000,
    hasShipped: true,
    handedOverAt: "2026-01-01T00:00:00Z",
    returnHours: 24,
  };
  assert.doesNotThrow(() =>
    refundQuote({ ...p, now: Date.parse("2026-01-02T00:00:00Z") }),
  );
  assert.throws(() =>
    refundQuote({ ...p, now: Date.parse("2026-01-02T00:00:01Z") }),
  );
});
test("deposit and split delivery limits", () => {
  const o = {
    acceptedAt: new Date(),
    paidCents: 500000,
    productCents: 1000000,
    totalCents: 1000000,
    feesCents: 0,
    quantity: 100,
  };
  assert.doesNotThrow(() => canDispatch(o, 40, 0));
  assert.throws(() => canDispatch({ ...o, paidCents: 499999 }, 40, 0));
  assert.throws(() => canDispatch(o, 70, 40));
  assert.equal(deliveryBalance(o, 40), 700000);
  assert.equal(deliveryBalance(o, 100), 1000000);
});
test("ledger rejects unbalanced and invalid entries", () => {
  assert.equal(
    balanced([
      { account: "Bank", debitCents: 100, creditCents: 0 },
      { account: "Deposits", debitCents: 0, creditCents: 100 },
    ]),
    true,
  );
  assert.throws(() =>
    balanced([
      { account: "Bank", debitCents: 100, creditCents: 0 },
      { account: "Deposits", debitCents: 0, creditCents: 99 },
    ]),
  );
  assert.throws(() => cents(NaN));
  assert.throws(() => cents(-2));
});
