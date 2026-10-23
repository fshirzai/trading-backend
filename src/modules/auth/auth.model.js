import { model, Schema } from "../../shared/model.js";
export const User = model("User", {
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  phone: String,
  country: String,
  address: String,
  avatarVersion: String,
  lastLoginAt: Date,
  emailVerified: { type: Boolean, default: false },
  verificationSentAt: Date,
  verificationResends: { type: Number, default: 0 },
  resetSentAt: Date,
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: String,
  mfaPendingSecret: String,
  mfaPendingAt: Date,
  mfaLastCounter: Number,
  recoveryHashes: [String],
  tokenVersion: { type: Number, default: 0 },
  loginFailures: { type: Number, default: 0 },
  lockedUntil: Date,
  role: {
    type: String,
    enum: ["admin", "manager", "seller", "procurement", "customer"],
    default: "customer",
  },
  active: { type: Boolean, default: true },
});

export const Session = model(
  "Session",
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    refreshHash: { type: String, required: true, unique: true },
    previousHashes: [String],
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
  },
  [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
);
Session.schema.index({ previousHashes: 1 });
User.schema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: "admin" } },
);
