import express from "express";
import { randomUUID } from "node:crypto";
import { SystemSettings, CompanyLogo } from "./settings.model.js";
import { publicSettings } from "./settings.service.js";
import { normalizeProductImage } from "../catalog/product-images.service.js";
import { wrap, roles, tx, audit } from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
const admin = () => roles("admin");
async function current(revision, s) {
  requireRule(
    Number.isSafeInteger(revision) && revision >= 0,
    "Settings revision required",
  );
  let settings = await SystemSettings.findById("company").session(s);
  if (!settings) settings = new SystemSettings();
  if (settings.revision !== revision)
    throw new RuleError("Settings changed; reload before saving", 409);
  return settings;
}
export function mountPublicSettings(app) {
  app.get(
    "/api/settings/public",
    wrap(async (req, res) => res.json(await publicSettings())),
  );
  app.get(
    ["/api/settings/logo", "/api/settings/logo/:version"],
    wrap(async (req, res) => {
      const meta = await SystemSettings.findById("company")
        .select("logoVersion")
        .lean();
      if (!meta?.logoVersion) throw new RuleError("Logo not found", 404);
      const logo = await CompanyLogo.findById("company").select("+data");
      if (!logo) throw new RuleError("Logo not found", 404);
      res.set({
        "Content-Type": "image/webp",
        "Content-Disposition": 'inline; filename="company-logo.webp"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
      res.send(Buffer.from(logo.data));
    }),
  );
}
export function mountSettings(app) {
  app.get(
    "/api/admin/settings",
    admin(),
    wrap(async (req, res) => res.json(await publicSettings())),
  );
  app.patch(
    "/api/admin/settings",
    admin(),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const settings = await current(req.body.revision, s);
          const before = await publicSettings(s);
          const { revision, ...fields } = req.body;
          Object.assign(settings, fields);
          settings.revision++;
          settings.updatedBy = req.user.id;
          await settings.save({ session: s });
          await audit(req, s, "settings.update", "SystemSettings", "company", {
            before,
            after: fields,
            revision: settings.revision,
          });
          return publicSettings(s);
        }),
      ),
    ),
  );
  app.post(
    "/api/admin/settings/logo",
    admin(),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "3mb",
    }),
    wrap(async (req, res) => {
      const revision = Number(req.headers["x-settings-revision"]);
      requireRule(
        /^\d{1,9}$/.test(req.headers["x-settings-revision"] || ""),
        "X-Settings-Revision header required",
      );
      const image = await normalizeProductImage(
        req.body,
        req.headers["content-type"],
      );
      const out = await tx(async (s) => {
        const settings = await current(revision, s);
        await CompanyLogo.findOneAndUpdate(
          { _id: "company" },
          { $set: { data: image.data, mime: "image/webp" } },
          { upsert: true, session: s },
        );
        settings.logoVersion = randomUUID();
        settings.revision++;
        settings.updatedBy = req.user.id;
        await settings.save({ session: s });
        await audit(
          req,
          s,
          "settings.logo.upload",
          "SystemSettings",
          "company",
          { revision: settings.revision },
        );
        return publicSettings(s);
      });
      res.status(201).json(out);
    }),
  );
  app.post(
    "/api/admin/settings/logo/remove",
    admin(),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const settings = await current(req.body.revision, s);
          await CompanyLogo.deleteOne({ _id: "company" }, { session: s });
          settings.logoVersion = undefined;
          settings.revision++;
          settings.updatedBy = req.user.id;
          await settings.save({ session: s });
          await audit(
            req,
            s,
            "settings.logo.remove",
            "SystemSettings",
            "company",
            { revision: settings.revision },
          );
          return publicSettings(s);
        }),
      ),
    ),
  );
}
