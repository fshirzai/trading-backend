import { model, Schema } from "../../shared/model.js";
export const Purchase = model("Purchase", {
  supplier: { type: Schema.Types.ObjectId, ref: "Party", required: true },
  product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  quantity: { type: Number, required: true },
  costCents: { type: Number, required: true },
  paidCents: { type: Number, default: 0 },
  status: { type: String, default: "Ordered" },
  receivedAt: Date,
});

export const SupplierPayment = model("SupplierPayment", {
  purchase: { type: Schema.Types.ObjectId, ref: "Purchase", required: true },
  amountCents: Number,
  reference: { type: String, unique: true, required: true },
});
