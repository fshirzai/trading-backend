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
});
Batch.schema.index({ product: 1, warehouse: 1, condition: 1, createdAt: 1 });
