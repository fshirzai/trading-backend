import express from "express";
import { randomBytes } from "node:crypto";
import { SystemSettings, CompanyPhoto } from "./settings.model.js";
import { publicSettings } from "./settings.service.js";
import { normalizeProductImage } from "../catalog/product-images.service.js";
import { wrap, roles, tx, audit } from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
export function mountPublicCompanyPhotos(app) {
  app.get(
    "/api/settings/photos/:id",
    wrap(async (req, res) => {
      const s = await publicSettings();
      if (!s.aboutImages.some((x) => x.id === req.params.id))
        throw new RuleError("Photo not found", 404);
      const image = await CompanyPhoto.findById(req.params.id).select("+data");
      if (!image) throw new RuleError("Photo not found", 404);
      res
        .set({
          "Content-Type": "image/webp",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public,max-age=300",
        })
        .send(Buffer.from(image.data));
    }),
  );
}
export function mountCompanyPhotos(app) {
  app.post(
    "/api/admin/settings/photos",
    roles("admin"),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "3mb",
    }),
    wrap(async (req, res) => {
      requireRule(
        /^\d{1,9}$/.test(req.headers["x-settings-revision"] || ""),
        "Settings revision required",
      );
      const image = await normalizeProductImage(
        req.body,
        req.headers["content-type"],
      );
      const out = await tx(async (session) => {
        const current = await publicSettings(session);
        requireRule(
          current.revision === Number(req.headers["x-settings-revision"]),
          "Settings changed; reload before saving",
        );
        requireRule(
          current.aboutImages.length < 4,
          "Maximum four About photos",
        );
        const [photo] = await CompanyPhoto.create([{ data: image.data }], {
          session,
        });
        let s =
          (await SystemSettings.findById("company").session(session)) ||
          new SystemSettings();
        s.aboutImages = [
          ...current.aboutImages,
          { id: photo.id, alt: "Company photo" },
        ];
        s.revision++;
        s.updatedBy = req.user.id;
        await s.save({ session });
        await audit(
          req,
          session,
          "settings.photo.upload",
          "SystemSettings",
          "company",
        );
        return publicSettings(session);
      });
      res.status(201).json(out);
    }),
  );
}
