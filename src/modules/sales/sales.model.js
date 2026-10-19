import { model, Schema } from "../../shared/model.js";
export const Inquiry = model("Inquiry", {
  customer: { type: Schema.Types.ObjectId, ref: "Party", required: true },
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, min: 0.001, required: true },
  source: { type: String, enum: ["website", "whatsapp", "phone", "office"] },
  destination: String,
  status: { type: String, default: "New" },
});

export const Order = model("Order", {
  inquiry: { type: Schema.Types.ObjectId, ref: "Inquiry" },
  customer: { type: Schema.Types.ObjectId, ref: "Party", required: true },
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, min: 0.001, required: true },
  splitIncluded: { type: Boolean, default: false },
  productCents: { type: Number, required: true },
  feesCents: { type: Number, default: 0 },
  totalCents: { type: Number, required: true },
  paidCents: { type: Number, default: 0 },
  refundedCents: { type: Number, default: 0 },
  depositCents: { type: Number, default: 0 },
  receivableCents: { type: Number, default: 0 },
  revenueCents: { type: Number, default: 0 },
  border: { type: String, required: true },
  status: { type: String, default: "Awaiting acceptance" },
  productSnapshot: Schema.Types.Mixed,
  proformaHistory: [Schema.Types.Mixed],
  version: { type: Number, default: 1 },
  acceptedAt: Date,
  acceptedSnapshot: Schema.Types.Mixed,
  handedOverAt: Date,
  returnHours: { type: Number, default: 24 },
});
Order.schema.index({ customer: 1, _id: -1 });
Inquiry.schema.index({ customer: 1, _id: -1 });

Order.schema.index({ createdAt: 1 });
Order.schema.index({ customer: 1, createdAt: -1 });
