import * as OTPAuth from "otpauth";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt, digest } from "../../shared/encryption.js";
import { requireRule } from "../../shared/rules.js";
export const totp = (secret, email) =>
  new OTPAuth.TOTP({
    issuer: "Trading Company",
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
export function verifyMfa(user, code, config) {
  if (!user.mfaEnabled) return null;
  requireRule(code, "MFA code required");
  if (/^\d{6}$/.test(code)) {
    const delta = totp(
      decrypt(user.mfaSecret, config.encryptionKey),
      user.email,
    ).validate({ token: code, window: 1 });
    requireRule(delta !== null, "Invalid MFA code");
    const counter = Math.floor(Date.now() / 30000) + delta;
    requireRule(counter > (user.mfaLastCounter ?? -1), "MFA code already used");
    user.mfaLastCounter = counter;
  } else {
    const hashed = digest(code),
      i = user.recoveryHashes.indexOf(hashed);
    requireRule(i >= 0, "Invalid MFA recovery code");
    user.recoveryHashes.splice(i, 1);
  }
  return true;
}
export const recoveryCodes = () =>
  Array.from({ length: 10 }, () => randomBytes(12).toString("hex"));
