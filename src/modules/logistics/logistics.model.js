import { model, Schema } from "../../shared/model.js";
export const Shipment = model("Shipment", {
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  quantity: { type: Number, required: true },
  item: String,
  product: { type: Schema.Types.ObjectId, ref: "Product" },
  saleCents: Number,
  direct: { type: Boolean, default: false },
  sourceBorder: String,
  warehouse: { type: Schema.Types.ObjectId, ref: "Warehouse" },
  border: String,
  driver: String,
  phone: String,
  vehicle: String,
  feeCents: { type: Number, default: 0 },
  feeAcceptedAt: Date,
  acceptanceEvidence: String,
  splitIncluded: { type: Boolean, default: false },
  status: { type: String, default: "In transit" },
  recipient: String,
  proof: String,
  handedOverAt: Date,
  costCents: { type: Number, default: 0 },
  allocations: [
    {
      batch: Schema.Types.ObjectId,
      quantity: Number,
      unitCostCents: Number,
      valueCents: Number,
    },
  ],
});
Shipment.schema.index({ order: 1, _id: -1 });
