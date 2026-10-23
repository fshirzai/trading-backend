import express from "express";
import { randomUUID } from "node:crypto";
import { User, Party, Session } from "../../models.js";
import { ProfileImage } from "./profile.model.js";
import { normalizeProductImage } from "../catalog/product-images.service.js";
import { wrap, tx, entity, audit } from "../../shared/services.js";
import { RuleError, requireRule } from "../../shared/rules.js";
export const safeProfile = (u) => ({
  id: u.id || String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  phone: u.phone || "",
  country: u.country || "",
  address: u.address || "",
  avatarVersion: u.avatarVersion || "",
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
  emailVerified: u.emailVerified,
  mfaEnabled: u.mfaEnabled,
});
export function mountProfile(app) {
  app.get(
    "/api/me/profile",
    wrap(async (req, res) =>
      res.json(safeProfile(await entity(User, req.user.id))),
    ),
  );
  app.patch(
    "/api/me/profile",
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const u = await entity(User, req.user.id, s);
          const before = {
            name: u.name,
            phone: u.phone,
            country: u.country,
            address: u.address,
          };
          Object.assign(u, req.body);
          await u.save({ session: s });
          if (u.role === "customer")
            await Party.updateMany(
              { userId: u.id, type: "customer" },
              {
                $set: {
                  name: u.name,
                  phone: u.phone,
                  country: u.country,
                  address: u.address,
                },
              },
              { session: s },
            );
          await audit(req, s, "profile.update", "User", u.id, {
            before,
            after: req.body,
          });
          return safeProfile(u);
        }),
      ),
    ),
  );
  app.post(
    "/api/me/avatar",
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "3mb",
    }),
    wrap(async (req, res) => {
      const image = await normalizeProductImage(
        req.body,
        req.headers["content-type"],
      );
      const out = await tx(async (s) => {
        const u = await entity(User, req.user.id, s);
        await ProfileImage.findOneAndUpdate(
          { user: u.id },
          { $set: { data: image.thumbnail, mime: "image/webp" } },
          { upsert: true, session: s },
        );
        u.avatarVersion = randomUUID();
        await u.save({ session: s });
        await audit(req, s, "profile.avatar.upload", "User", u.id);
        return safeProfile(u);
      });
      res.status(201).json(out);
    }),
  );
  app.get(
    ["/api/me/avatar", "/api/me/avatar/:version"],
    wrap(async (req, res) => {
      const u = await entity(User, req.user.id);
      if (!u.avatarVersion) throw new RuleError("Profile image not found", 404);
      const image = await ProfileImage.findOne({ user: req.user.id }).select(
        "+data",
      );
      if (!image) throw new RuleError("Profile image not found", 404);
      res.set({
        "Content-Type": "image/webp",
        "Content-Disposition": 'inline; filename="profile.webp"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      });
      res.send(Buffer.from(image.data));
    }),
  );
  app.post(
    "/api/me/avatar/remove",
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const u = await entity(User, req.user.id, s);
          await ProfileImage.deleteOne({ user: u.id }, { session: s });
          u.avatarVersion = undefined;
          await u.save({ session: s });
          await audit(req, s, "profile.avatar.remove", "User", u.id);
          return safeProfile(u);
        }),
      ),
    ),
  );
  app.get(
    "/api/auth/sessions",
    wrap(async (req, res) => {
      const rows = await Session.find({
        user: req.user.id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
        .select("createdAt expiresAt")
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      res.json({
        items: rows.map((x) => ({
          ...x,
          current: String(x._id) === req.user.sessionId,
        })),
        nextCursor: null,
      });
    }),
  );
  app.post(
    "/api/auth/sessions/:id/revoke",
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const session = await entity(Session, req.params.id, s);
          if (String(session.user) !== req.user.id)
            throw new RuleError("Session not found", 404);
          if (!session.revokedAt) {
            session.revokedAt = new Date();
            await session.save({ session: s });
            await audit(req, s, "session.revoke", "Session", session.id);
          }
          return { id: session.id, current: session.id === req.user.sessionId };
        }),
      ),
    ),
  );
}
