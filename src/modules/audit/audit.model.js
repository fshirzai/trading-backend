import { model, Schema } from "../../shared/model.js";
export const Audit = model("Audit", {
  actor: { type: Schema.Types.ObjectId, ref: "User" },
  action: String,
  entity: String,
  entityId: String,
  details: Schema.Types.Mixed,
});
