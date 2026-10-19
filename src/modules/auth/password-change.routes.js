import { User, Session } from "./auth.model.js";
import { verifyPassword, hashPassword } from "./password.service.js";
import { verifyMfa } from "./mfa.service.js";
import { wrap, tx, entity, audit } from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
export function mountPasswordChange(app, config) {
  app.post(
    "/api/auth/change-password",
    wrap(async (req, res) => {
      const user = await User.findById(req.user.id).select("+passwordHash");
      requireRule(
        await verifyPassword(req.body.oldPassword, user.passwordHash),
        "Invalid credentials",
      );
      const passwordHash = await hashPassword(
        req.body.newPassword,
        config.scryptN,
      );
      await tx(async (s) => {
        const u = await entity(User, user.id, s);
        requireRule(
          u.tokenVersion === user.tokenVersion,
          "Session changed; sign in again",
        );
        if (u.mfaEnabled) verifyMfa(u, req.body.mfaCode, config);
        u.passwordHash = passwordHash;
        u.tokenVersion++;
        await u.save({ session: s });
        await Session.updateMany(
          { user: u.id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session: s },
        );
        await audit(req, s, "password.change", "User", u.id);
      });
      res.json({ message: "Password changed; sign in again" });
    }),
  );
}
