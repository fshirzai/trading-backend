import { model, Schema } from "../../shared/model.js";
export const HesabAccount = model("HesabAccount", {
  label: String,
  environment: { type: String, enum: ["sandbox", "production"] },
  apiKeyCipher: { type: String, select: false },
  callbackCipher: { type: String, select: false },
  callbackHash: { type: String, select: false },
  rateMicros: Number,
  approved: Boolean,
  active: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
});
export const HesabConfig = model("HesabConfig", {
  _id: { type: String, default: "hesabpay" },
  account: { type: Schema.Types.ObjectId, ref: "HesabAccount" },
  revision: { type: Number, default: 0 },
  enabled: { type: Boolean, default: false },
});
