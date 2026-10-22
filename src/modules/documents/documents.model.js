import { model, Schema } from "../../shared/model.js";
export const Document = model("Document", {
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  order: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  kind: {
    type: String,
    enum: ["payment-receipt", "trade-document"],
    required: true,
  },
  name: String,
  normalized: { type: Boolean, default: false },
  data: { type: Buffer, select: false },
  mime: String,
  size: Number,
  sha256: String,
  scanLockedUntil: Date,
  lastScanError: String,
  status: {
    type: String,
    enum: ["Quarantined", "Clean", "Rejected"],
    default: "Quarantined",
  },
});
