import { model, Schema } from "../../shared/model.js";
export const Purchase = model("Purchase", {
  supplier: { type: Schema.Types.ObjectId, ref: "Party", required: true },
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, required: true },
  costCents: { type: Number, required: true },
  paidCents: { type: Number, default: 0 },
  status: { type: String, default: "Ordered" },
  receivedAt: Date,
  request: { type: Schema.Types.ObjectId, ref: "ProcurementRequest" },
  order: { type: Schema.Types.ObjectId, ref: "Order" },
  receivedBatch: { type: Schema.Types.ObjectId, ref: "Batch" },
});

export const SupplierPayment = model("SupplierPayment", {
  purchase: { type: Schema.Types.ObjectId, ref: "Purchase", required: true },
  amountCents: Number,
  reference: { type: String, unique: true, required: true },
});

export const ProcurementRequest = model("ProcurementRequest", {
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  item: String,
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, min: 0.001, required: true },
  receivedQuantity: { type: Number, default: 0 },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  note: String,
  status: {
    type: String,
    enum: ["Requested", "Purchasing", "Received", "Cancelled"],
    default: "Requested",
  },
});
ProcurementRequest.schema.index({ order: 1, status: 1 });

ProcurementRequest.schema.index(
  { order: 1, item: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["Requested", "Purchasing"] } },
  },
);
