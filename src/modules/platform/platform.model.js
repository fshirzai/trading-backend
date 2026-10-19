import { model, Schema } from "../../shared/model.js";
export const Idempotency = model(
  "Idempotency",
  {
    key: { type: String, unique: true, required: true },
    fingerprint: String,
    response: Schema.Types.Mixed,
    status: Number,
    expiresAt: Date,
  },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
);
