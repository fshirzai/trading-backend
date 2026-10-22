import { User, Session } from "./auth.model.js";
import * as OTPAuth from "otpauth";
import { encrypt, decrypt, digest } from "../../shared/encryption.js";
import { totp, verifyMfa, recoveryCodes } from "./mfa.service.js";
import { verifyPassword } from "./password.service.js";
import { tx, wrap, entity, audit } from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
export function mountMfa(app, config) {
  app.post(
    "/api/auth/mfa/enroll",
    wrap(async (req, res) => {
      const auth = await User.findById(req.user.id).select("+passwordHash");
      requireRule(
        await verifyPassword(req.body.password, auth.passwordHash),
        "Invalid credentials",
      );
      const out = await tx(async (s) => {
        const u = await entity(User, req.user.id, s);
        requireRule(!u.mfaEnabled, "MFA already enabled");
        const secret = new OTPAuth.Secret({ size: 20 }).base32;
        u.mfaPendingSecret = encrypt(secret, config.encryptionKey);
        u.mfaPendingAt = new Date();
        await u.save({ session: s });
        return {
          secret,
          uri: totp(secret, u.email).toString(),
          expiresIn: 300,
        };
      });
      res.json(out);
    }),
  );
  app.post(
    "/api/auth/mfa/confirm",
    wrap(async (req, res) => {
      const out = await tx(async (s) => {
        const u = await entity(User, req.user.id, s);
        requireRule(
          !u.mfaEnabled &&
            u.mfaPendingSecret &&
            u.mfaPendingAt > Date.now() - 300000,
          "Enrollment expired",
        );
        const secret = decrypt(u.mfaPendingSecret, config.encryptionKey),
          delta = totp(secret, u.email).validate({
            token: req.body.code,
            window: 1,
          });
        requireRule(delta !== null, "Invalid MFA code");
        const codes = recoveryCodes();
        u.mfaSecret = u.mfaPendingSecret;
        u.mfaPendingSecret = undefined;
        u.mfaPendingAt = undefined;
        u.mfaEnabled = true;
        u.mfaLastCounter = Math.floor(Date.now() / 30000) + delta;
        u.recoveryHashes = codes.map(digest);
        u.tokenVersion++;
        await u.save({ session: s });
        await Session.updateMany(
          { user: u.id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session: s },
        );
        await audit(req, s, "mfa.enable", "User", u.id);
        return {
          recoveryCodes: codes,
          message: "Store recovery codes securely. Sign in again.",
        };
      });
      res.json(out);
    }),
  );
  app.post(
    "/api/auth/mfa/disable",
    wrap(async (req, res) => {
      const u = await User.findById(req.user.id).select("+passwordHash");
      requireRule(
        await verifyPassword(req.body.password, u.passwordHash),
        "Invalid credentials",
      );
      await tx(async (s) => {
        const current = await entity(User, u.id, s);
        requireRule(current.mfaEnabled, "MFA not enabled");
        verifyMfa(current, req.body.code, config);
        current.mfaEnabled = false;
        current.mfaSecret = undefined;
        current.recoveryHashes = [];
        current.tokenVersion++;
        await current.save({ session: s });
        await Session.updateMany(
          { user: u.id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session: s },
        );
        await audit(req, s, "mfa.disable", "User", u.id);
      });
      res.json({ message: "MFA disabled; sign in again" });
    }),
  );
}
