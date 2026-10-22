import { mountPasswordChange } from "./password-change.routes.js";
import { queueToken } from "../email/email.service.js";
import { mountRecovery } from "./recovery.routes.js";
import { mountMfa } from "./mfa.routes.js";
import { verifyMfa } from "./mfa.service.js";
import { idempotencyMiddleware } from "../platform/idempotency.middleware.js";
import { randomBytes, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { User, Session, Party } from "../../models.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import {
  wrap,
  tx,
  roles,
  manage,
  entity,
  audit,
} from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
const hash = (x) => createHash("sha256").update(x).digest("hex");
const publicUser = (u) => ({
  id: u.id || String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  emailVerified: u.emailVerified,
  mfaEnabled: u.mfaEnabled,
});
function cookie(req) {
  const pair = (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("refresh="));
  return pair?.slice(8) || "";
}
function setCookie(res, token, config) {
  res.cookie("refresh", token, {
    httpOnly: true,
    secure: config.mode === "production",
    sameSite: "strict",
    path: "/api/auth",
    maxAge: 7 * 86400000,
  });
}
const clearCookie = (res, config) =>
  res.clearCookie("refresh", {
    httpOnly: true,
    secure: config.mode === "production",
    sameSite: "strict",
    path: "/api/auth",
  });
function issueAccess(user, session, config) {
  return jwt.sign({ sid: session.id, v: user.tokenVersion }, config.jwtSecret, {
    algorithm: "HS256",
    subject: user.id,
    expiresIn: "15m",
    issuer: "trading-mis",
    audience: "trading-web",
  });
}
export function authMiddleware(config) {
  return wrap(async (req, res, next) => {
    const token = req.headers.authorization?.match(
      /^Bearer ([A-Za-z\d_.-]+)$/,
    )?.[1];
    if (!token || token.length > 2048)
      throw new RuleError("Authentication required", 401);
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, {
        algorithms: ["HS256"],
        issuer: "trading-mis",
        audience: "trading-web",
      });
    } catch {
      throw new RuleError("Invalid session", 401);
    }
    if (
      !/^[a-f\d]{24}$/i.test(payload.sub || "") ||
      !/^[a-f\d]{24}$/i.test(payload.sid || "")
    )
      throw new RuleError("Invalid session", 401);
    const [user, session] = await Promise.all([
      User.findById(payload.sub).lean(),
      Session.findOne({
        _id: payload.sid,
        user: payload.sub,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean(),
    ]);
    if (!user?.active || !session || user.tokenVersion !== payload.v)
      throw new RuleError("Invalid session", 401);
    if (!user.emailVerified)
      throw new RuleError("Email verification required", 403);
    req.user = {
      id: String(user._id),
      role: user.role,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      sessionId: String(session._id),
    };
    next();
  });
}
export async function mountAuth(app, config, authLimiter) {
  const dummy = await hashPassword(
    randomBytes(32).toString("hex"),
    config.scryptN,
  );
  mountRecovery(app, config, authLimiter);
  app.post(
    "/api/auth/register",
    authLimiter,
    wrap(async (req, res) => {
      const hash = await hashPassword(req.body.password, config.scryptN);
      await tx(async (s) => {
        if (await User.exists({ email: req.body.email }).session(s)) return;
        const [u] = await User.create(
          [
            {
              name: req.body.name,
              email: req.body.email,
              passwordHash: hash,
              role: "customer",
              verificationSentAt: new Date(),
            },
          ],
          { session: s },
        );
        await queueToken(u, "verify", config, s);
        await Party.create(
          [
            {
              name: u.name,
              email: u.email,
              country: req.body.country,
              type: "customer",
              userId: u.id,
            },
          ],
          { session: s },
        );
      });
      res
        .status(201)
        .json({ message: "If eligible, a verification email has been queued" });
    }),
  );
  app.post(
    "/api/auth/login",
    authLimiter,
    wrap(async (req, res) => {
      const u = await User.findOne({ email: req.body.email }).select(
        "+passwordHash",
      );
      const valid = await verifyPassword(
        req.body.password,
        u?.passwordHash || dummy,
      );
      if (
        !u?.active ||
        !valid ||
        (u.lockedUntil && u.lockedUntil > new Date())
      ) {
        if (u && !valid) {
          await User.updateOne({ _id: u.id }, { $inc: { loginFailures: 1 } });
          const fresh = await User.findById(u.id);
          if (fresh.loginFailures >= 5)
            await User.updateOne(
              { _id: u.id },
              { $set: { lockedUntil: new Date(Date.now() + 15 * 60000) } },
            );
        }
        throw new RuleError("Invalid credentials", 401);
      }
      requireRule(u.emailVerified, "Verify your email before signing in");
      if (u.mfaEnabled)
        await tx(async (s) => {
          const fresh = await User.findById(u.id).session(s);
          verifyMfa(fresh, req.body.mfaCode, config);
          await fresh.save({ session: s });
        });
      await User.updateOne(
        { _id: u.id },
        { $set: { loginFailures: 0 }, $unset: { lockedUntil: 1 } },
      );
      const token = randomBytes(32).toString("hex");
      const session = await Session.create({
        user: u.id,
        refreshHash: hash(token),
        expiresAt: new Date(Date.now() + 7 * 86400000),
      });
      setCookie(res, token, config);
      res.json({
        accessToken: issueAccess(u, session, config),
        expiresIn: 900,
        user: publicUser(u),
      });
    }),
  );
  app.post(
    "/api/auth/refresh",
    authLimiter,
    wrap(async (req, res) => {
      requireRule(
        req.headers.origin && config.origins.includes(req.headers.origin),
        "Refresh requires a trusted Origin",
      );
      const raw = cookie(req);
      if (!/^[a-f\d]{64}$/.test(raw))
        throw new RuleError("Invalid session", 401);
      const oldHash = hash(raw);
      let compromised = false;
      const out = await tx(async (s) => {
        const session = await Session.findOne({
          $or: [{ refreshHash: oldHash }, { previousHashes: oldHash }],
        }).session(s);
        if (!session || session.revokedAt || session.expiresAt <= new Date())
          return null;
        if (session.refreshHash !== oldHash) {
          session.revokedAt = new Date();
          await session.save({ session: s });
          compromised = true;
          return null;
        }
        const u = await User.findById(session.user).session(s);
        if (!u?.active) return null;
        const next = randomBytes(32).toString("hex");
        session.previousHashes.push(oldHash);
        if (session.previousHashes.length > 100) {
          session.revokedAt = new Date();
          await session.save({ session: s });
          return null;
        }
        session.refreshHash = hash(next);
        await session.save({ session: s });
        return { next, accessToken: issueAccess(u, session, config) };
      });
      if (!out) {
        clearCookie(res, config);
        throw new RuleError(
          compromised
            ? "Session reuse detected; sign in again"
            : "Invalid session",
          401,
        );
      }
      setCookie(res, out.next, config);
      res.json({ accessToken: out.accessToken, expiresIn: 900 });
    }),
  );

  const authenticate = authMiddleware(config);
  app.use("/api", (req, res, next) =>
    authenticate(req, res, (err) => (err ? next(err) : next())),
  );

  app.use("/api", idempotencyMiddleware);
  mountMfa(app, config);
  mountPasswordChange(app, config);
  app.get("/api/me", (req, res) => res.json(req.user));
  app.post(
    "/api/auth/logout",
    wrap(async (req, res) => {
      await Session.updateOne(
        { _id: req.user.sessionId, user: req.user.id },
        { $set: { revokedAt: new Date() } },
      );
      clearCookie(res, config);
      res.status(204).end();
    }),
  );
  app.post(
    "/api/auth/logout-all",
    wrap(async (req, res) => {
      await tx(async (s) => {
        await User.updateOne(
          { _id: req.user.id },
          { $inc: { tokenVersion: 1 } },
          { session: s },
        );
        await Session.updateMany(
          { user: req.user.id, revokedAt: null },
          { $set: { revokedAt: new Date() } },
          { session: s },
        );
        await audit(req, s, "session.revoke-all", "User", req.user.id);
      });
      clearCookie(res, config);
      res.status(204).end();
    }),
  );
  app.post(
    "/api/users",
    manage,
    wrap(async (req, res) => {
      requireRule(
        req.user.role === "admin" || req.body.role !== "manager",
        "Only admin creates managers",
      );
      const passwordHash = await hashPassword(
        req.body.password,
        config.scryptN,
      );
      const out = await tx(async (s) => {
        const [u] = await User.create(
          [
            {
              name: req.body.name,
              email: req.body.email,
              role: req.body.role,
              emailVerified: false,
              passwordHash,
            },
          ],
          { session: s },
        );
        await queueToken(u, "verify", config, s);
        await audit(req, s, "user.create", "User", u.id);
        return publicUser(u);
      });
      res.status(201).json(out);
    }),
  );
  app.patch(
    "/api/users/:id",
    roles("admin"),
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const u = await entity(User, req.params.id, s);
          requireRule(
            u.role !== "admin",
            "Admin accounts require an administrator recovery procedure",
          );
          Object.assign(u, req.body);
          u.tokenVersion++;
          await u.save({ session: s });
          await Session.updateMany(
            { user: u.id, revokedAt: null },
            { $set: { revokedAt: new Date() } },
            { session: s },
          );
          await audit(req, s, "user.update", "User", u.id, {
            active: u.active,
            role: u.role,
          });
          return publicUser(u);
        }),
      );
    }),
  );
}
