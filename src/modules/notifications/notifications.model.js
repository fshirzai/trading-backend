import { model, Schema } from "../../shared/model.js";
export const Notification = model(
  "Notification",
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: String,
    entity: String,
    entityId: String,
    readAt: Date,
  },
  [[{ user: 1, _id: -1 }, {}]],
);
