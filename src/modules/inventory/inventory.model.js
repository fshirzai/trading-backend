import { model, Schema } from "../../shared/model.js";
export const Warehouse = model("Warehouse", {
  name: { type: String, required: true },
  country: String,
  address: String,
  active: { type: Boolean, default: true },
});

export const Batch = model(
  "Batch",
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    warehouse: {
      type: Schema.Types.ObjectId,
      ref: "Warehouse",
      required: true,
    },
    code: { type: String, required: true },
    location: String,
    reservedQuantity: { type: Number, min: 0, default: 0 },
    purchase: { type: Schema.Types.ObjectId, ref: "Purchase" },
    returnId: { type: Schema.Types.ObjectId, ref: "Return" },
    quantity: { type: Number, min: 0, required: true },
    unitCostCents: { type: Number, min: 0, required: true },
    valueCents: { type: Number, min: 0, required: true },
    condition: { type: String, default: "Good" },
  },
  [[{ product: 1, warehouse: 1, code: 1 }, { unique: true }]],
);

export const Movement = model("Movement", {
  batch: { type: Schema.Types.ObjectId, ref: "Batch" },
  quantity: Number,
  kind: {
    type: String,
    enum: ["Receipt", "Dispatch", "TransferOut", "TransferIn", "Return"],
  },
  order: { type: Schema.Types.ObjectId, ref: "Order" },
  reference: String,
  sourceBatch: { type: Schema.Types.ObjectId, ref: "Batch" },
  actor: { type: Schema.Types.ObjectId, ref: "User" },
});
Batch.schema.index({ product: 1, warehouse: 1, condition: 1, createdAt: 1 });

export const StockReservation = model("StockReservation", {
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  item: String,
  batch: { type: Schema.Types.ObjectId, ref: "Batch", required: true },
  quantity: { type: Number, min: 0, required: true },
  status: {
    type: String,
    enum: ["Active", "Consumed", "Released"],
    default: "Active",
  },
});
StockReservation.schema.index({ order: 1, status: 1 });
StockReservation.schema.index({ batch: 1, status: 1 });
