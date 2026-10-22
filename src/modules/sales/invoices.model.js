import { model, Schema } from "../../shared/model.js";
export const Invoice = model(
  "Invoice",
  {
    order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    number: { type: String, required: true, unique: true },
    fingerprint: { type: String, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  [[{ order: 1, fingerprint: 1 }, { unique: true }]],
);
