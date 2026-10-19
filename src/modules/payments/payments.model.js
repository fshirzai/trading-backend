import { model, Schema } from "../../shared/model.js";
export const Payment = model(
  "Payment",
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    amountCents: { type: Number, required: true },
    method: { type: String, enum: ["TT", "VISA"], required: true },
    reference: { type: String, required: true },
    receiptKey: String,
    status: {
      type: String,
      enum: ["Pending", "Verified", "Rejected"],
      default: "Pending",
    },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
    verifiedAt: Date,
  },
  [[{ method: 1, reference: 1 }, { unique: true }]],
);
Payment.schema.index({ order: 1, _id: -1 });
export const CheckoutAttempt = model("CheckoutAttempt", {
  order: { type: Schema.Types.ObjectId, ref: "Order" },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  amountCents: Number,
  key: { type: String, unique: true },
  providerSession: { type: String, index: true },
  providerIntent: String,
  url: String,
  state: { type: String, default: "Creating" },
  currency: { type: String, default: "usd" },
});
export const GatewayEvent = model("GatewayEvent", {
  eventId: { type: String, unique: true },
  type: String,
  processedAt: Date,
});
export const CardRefund = model("CardRefund", {
  return: { type: Schema.Types.ObjectId, ref: "Return" },
  payment: { type: Schema.Types.ObjectId, ref: "Payment" },
  amountCents: Number,
  key: { type: String, unique: true },
  providerId: String,
  status: { type: String, default: "Pending" },
});

Payment.schema.index({ status: 1, _id: -1 });
