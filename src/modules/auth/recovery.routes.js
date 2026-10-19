import { User, Session } from "./auth.model.js";
import { EmailToken } from "../email/email.model.js";
import { queueToken } from "../email/email.service.js";
import { digest } from "../../shared/encryption.js";
import { hashPassword } from "./password.service.js";
import { tx, wrap, audit } from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
export function mountRecovery(app, config, limiter) {
  app.post(
    "/api/auth/verify-email",
    limiter,
    wrap(async (req, res) => {
      await tx(async (s) => {
        const token = await EmailToken.findOne({
          kind: "verify",
          tokenHash: digest(req.body.token),
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        }).session(s);
        requireRule(token, "Verification link invalid or expired");
        const u = await User.findById(token.user).session(s);
        requireRule(u?.active, "Account unavailable");
        u.emailVerified = true;
        await u.save({ session: s });
        token.consumedAt = new Date();
        await token.save({ session: s });
        await audit({ user: { id: u.id } }, s, "email.verify", "User", u.id);
      });
      res.json({ message: "Email verified" });
    }),
  );
  app.post(
    "/api/auth/resend-verification",
    limiter,
    wrap(async (req, res) => {
      await tx(async (s) => {
        const u = await User.findOne({
          email: req.body.email,
          active: true,
          emailVerified: { $ne: true },
        }).session(s);
        if (!u) return;
        const wait = [60000, 300000, 3600000][
          Math.min(u.verificationResends || 0, 2)
        ];
        if (
          u.verificationSentAt &&
          Date.now() - u.verificationSentAt.getTime() < wait
        )
          return;
        u.verificationSentAt = new Date();
        u.verificationResends = (u.verificationResends || 0) + 1;
        await u.save({ session: s });
        await queueToken(u, "verify", config, s);
      });
      res.json({
        message: "If eligible, a verification email has been queued",
      });
    }),
  );
  app.post(
    "/api/auth/forgot-password",
    limiter,
    wrap(async (req, res) => {
      await tx(async (s) => {
        const u = await User.findOne({
          email: req.body.email,
          active: true,
        }).session(s);
        if (
          !u ||
          (u.resetSentAt && Date.now() - u.resetSentAt.getTime() < 60000)
        )
          return;
        u.resetSentAt = new Date();
        await u.save({ session: s });
        await queueToken(u, "reset", config, s);
      });
      res.json({
        message:
          "If the account exists, a password reset email has been queued",
      });
    }),
  );
  app.post(
    "/api/auth/reset-password",
    limiter,
    wrap(async (req, res) => {
      const passwordHash = await hashPassword(
        req.body.password,
        config.scryptN,
      );
      await tx(async (s) => {
        const token = await EmailToken.findOne({
          kind: "reset",
          tokenHash: digest(req.body.token),
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        }).session(s);
        requireRule(token, "Reset link invalid or expired");
        const u = await User.findById(token.user).session(s);
        requireRule(u?.active, "Account unavailable");
        u.passwordHash = passwordHash;
        u.tokenVersion++;
        u.loginFailures = 0;
        u.lockedUntil = undefined;
        await u.save({ session: s });
        token.consumedAt = new Date();
        await token.save({ session: s });
        await Session.updateMany(
          { user: u.id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session: s },
        );
        await audit({ user: { id: u.id } }, s, "password.reset", "User", u.id);
      });
      res.json({ message: "Password reset. Sign in again." });
    }),
  );
}
