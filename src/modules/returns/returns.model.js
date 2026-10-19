import { model, Schema } from "../../shared/model.js";
export const Return = model("Return", {
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  cardRefundReservedCents: { type: Number, default: 0 },
  reason: String,
  previousStatus: String,
  rejectionReason: String,
  status: { type: String, default: "Requested" },
  retainedCents: Number,
  refundCents: Number,
  requestedAt: Date,
  hasShipped: Boolean,
  inspection: Schema.Types.Mixed,
  refundedAt: Date,
});
Return.schema.index({ order: 1, _id: -1 });
