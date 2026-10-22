import { model, Schema } from "../../shared/model.js";
export const Return = model("Return", {
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  cardRefundReservedCents: { type: Number, default: 0 },
  reason: String,
  warehouse: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  receivedBatches: [{ type: Schema.Types.ObjectId, ref: "Batch" }],
  refundReference: String,
  completedBy: { type: Schema.Types.ObjectId, ref: "User" },
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
