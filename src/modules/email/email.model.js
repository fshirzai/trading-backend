import { model, Schema } from "../../shared/model.js";
export const EmailToken = model(
  "EmailToken",
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["verify", "reset"], required: true },
    tokenHash: { type: String, unique: true, required: true },
    expiresAt: Date,
    consumedAt: Date,
  },
  [
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
    [{ user: 1, kind: 1, consumedAt: 1 }, {}],
  ],
);
export const EmailJob = model(
  "EmailJob",
  {
    payload: { type: String, required: true },
    state: {
      type: String,
      enum: ["Queued", "Sending", "Sent", "Failed"],
      default: "Queued",
    },
    attempts: { type: Number, default: 0 },
    availableAt: Date,
    lockedUntil: Date,
    lastError: String,
    validUntil: Date,
    sentAt: Date,
  },
  [[{ state: 1, availableAt: 1 }, {}]],
);
