export class RuleError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}
export const requireRule = (condition, message, status = 422) => {
  if (!condition) throw new RuleError(message, status);
};
export function cents(value) {
  requireRule(
    typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= 1000000000 &&
      Number.isSafeInteger(Math.round(value * 100)) &&
      Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    "Positive USD amount with at most two decimals required",
  );
  return Math.round(value * 100);
}
export const quantitySum = (values) =>
  Math.round(values.reduce((s, x) => s + x, 0) * 1000) / 1000;
export function refundQuote({
  totalCents,
  paidCents,
  hasShipped,
  handedOverAt,
  returnHours = 24,
  now = Date.now(),
}) {
  requireRule(
    Number.isSafeInteger(totalCents) &&
      totalCents > 0 &&
      Number.isSafeInteger(paidCents) &&
      paidCents >= 0 &&
      paidCents <= totalCents,
    "Invalid order amounts",
  );
  if (handedOverAt) {
    const at = new Date(handedOverAt).getTime();
    requireRule(
      Number.isFinite(at) && Number.isInteger(returnHours) && returnHours > 0,
      "Invalid inspection window",
    );
    requireRule(
      now <= at + returnHours * 3600000,
      "Return request deadline expired",
    );
  }
  const retainedCents = hasShipped ? Math.round(totalCents * 0.25) : 0;
  requireRule(
    paidCents >= retainedCents,
    "Paid amount does not cover cancellation charge",
  );
  return { retainedCents, refundCents: paidCents - retainedCents };
}
export function canDispatch(order, quantity, alreadyShipped) {
  requireRule(order.acceptedAt, "Accept the proforma first");
  requireRule(
    !["Return requested", "Refunded", "Cancelled", "Delivered"].includes(
      order.status,
    ),
    "Order is closed for dispatch",
  );
  requireRule(
    order.paidCents >= Math.ceil(order.productCents * 0.5),
    "Verified 50% product deposit required",
  );
  requireRule(
    Number.isFinite(quantity) &&
      quantity > 0 &&
      quantitySum([quantity, alreadyShipped]) <= order.quantity,
    "Invalid shipment quantity",
  );
}
export function deliveryBalance(order, deliveredQuantity) {
  const deliveredValue = Math.round(
    (order.productCents * deliveredQuantity) / order.quantity,
  );
  return Math.min(
    order.totalCents,
    Math.ceil(order.productCents * 0.5) +
      Math.floor(deliveredValue * 0.5) +
      order.feesCents,
  );
}
export function balanced(lines) {
  requireRule(
    Array.isArray(lines) && lines.length >= 2,
    "At least two journal lines required",
  );
  let dr = 0,
    cr = 0;
  for (const l of lines) {
    requireRule(
      typeof l.account === "string" &&
        l.account &&
        Number.isSafeInteger(l.debitCents) &&
        Number.isSafeInteger(l.creditCents) &&
        l.debitCents >= 0 &&
        l.creditCents >= 0 &&
        l.debitCents > 0 !== l.creditCents > 0,
      "Journal lines must have either a debit or credit",
    );
    dr += l.debitCents;
    cr += l.creditCents;
  }
  requireRule(
    Number.isSafeInteger(dr) && Number.isSafeInteger(cr) && dr === cr && dr > 0,
    "Journal must balance",
  );
  return true;
}
