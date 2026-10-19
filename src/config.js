import path from "node:path";
import { createHash } from "node:crypto";
export function readConfig(env = process.env) {
  const mode = env.NODE_ENV || "development";
  if (
    env.DOCUMENT_UPLOADS_ENABLED !== undefined &&
    !["true", "false"].includes(env.DOCUMENT_UPLOADS_ENABLED)
  )
    throw Error("DOCUMENT_UPLOADS_ENABLED must be true or false");
  const documentUploadsEnabled = env.DOCUMENT_UPLOADS_ENABLED !== "false";
  const port = Number(env.PORT || 4000);
  const jwtSecret = env.JWT_SECRET;
  if (
    !["development", "test", "production"].includes(mode) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("Invalid server mode or port");
  if (
    !jwtSecret ||
    Buffer.byteLength(jwtSecret) < 64 ||
    /replace|example|changeme/i.test(jwtSecret)
  )
    throw Error(
      "JWT_SECRET must be at least 64 random bytes; placeholder secrets are refused",
    );
  if (!env.MONGODB_URI) throw Error("MONGODB_URI required");
  const origins = (env.WEB_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());
  for (const o of origins) {
    const u = new URL(o);
    if (
      u.origin !== o ||
      !["http:", "https:"].includes(u.protocol) ||
      (mode === "production" && u.protocol !== "https:")
    )
      throw Error(
        "WEB_ORIGINS must be exact origins; production requires HTTPS",
      );
  }
  if (env.TRUST_PROXY_HOPS && !/^[1-3]$/.test(env.TRUST_PROXY_HOPS))
    throw Error("TRUST_PROXY_HOPS must be 1–3 or unset");
  const returnHours = Number(env.RETURN_HOURS || 24);
  if (!Number.isInteger(returnHours) || returnHours < 1 || returnHours > 168)
    throw Error("RETURN_HOURS must be 1–168");
  if (mode === "production" && env.RETURN_POLICY_CONFIRMED !== "true")
    throw Error("Confirm the return policy and RETURN_HOURS before production");
  const frontendUrl = env.FRONTEND_URL || origins[0],
    front = new URL(frontendUrl);
  if (
    !origins.includes(front.origin) ||
    front.username ||
    front.password ||
    (mode === "production" && front.protocol !== "https:")
  )
    throw Error("FRONTEND_URL must use an allowed origin");
  for (const [name, value] of [
    ["SMTP_PORT", env.SMTP_PORT || 587],
    ["CLAMAV_PORT", env.CLAMAV_PORT || 3310],
  ])
    if (!Number.isInteger(Number(value)) || +value < 1 || +value > 65535)
      throw Error(name + " invalid");
  if (
    env.GATEWAY_PROVIDER &&
    !["disabled", "stripe"].includes(env.GATEWAY_PROVIDER)
  )
    throw Error("Unsupported GATEWAY_PROVIDER");
  const encryptionKey = env.DATA_ENCRYPTION_KEY
    ? Buffer.from(env.DATA_ENCRYPTION_KEY, "base64")
    : createHash("sha256").update(jwtSecret).digest();
  if (
    encryptionKey.length !== 32 ||
    (mode === "production" && !env.DATA_ENCRYPTION_KEY)
  )
    throw Error("DATA_ENCRYPTION_KEY must be a separate 32-byte base64 key");
  return {
    mode,
    documentUploadsEnabled,
    gatewayProvider: env.GATEWAY_PROVIDER || "disabled",
    stripeKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    gatewayApproved: env.GATEWAY_MERCHANT_APPROVED === "true",
    encryptionKey,
    requireStaffMfa: mode === "production",
    frontendUrl,
    smtpHost: env.SMTP_HOST,
    smtpPort: Number(env.SMTP_PORT || 587),
    smtpUser: env.SMTP_USER,
    smtpPassword: env.SMTP_PASSWORD,
    mailFrom: env.MAIL_FROM,
    clamHost: env.CLAMAV_HOST,
    clamPort: Number(env.CLAMAV_PORT || 3310),
    port,
    jwtSecret,
    mongoUri: env.MONGODB_URI,
    origins,
    returnHours,
    uploadDir: path.resolve(env.UPLOAD_DIR || "./var/uploads"),
    trustProxy: env.TRUST_PROXY_HOPS ? Number(env.TRUST_PROXY_HOPS) : false,
    scryptN: mode === "test" ? 16384 : 131072,
  };
}
