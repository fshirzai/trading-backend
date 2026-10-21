import express from "express";
import { Product, ProductImage } from "./catalog.model.js";
import { wrap, roles, entity, tx, audit } from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
import {
  MAX_PRODUCT_IMAGES,
  MAX_IMAGE_INPUT,
  normalizeProductImage,
} from "./product-images.service.js";

const staff = () => roles("admin", "manager", "procurement");
const current = (product, version) => {
  requireRule(
    Number.isInteger(version) && version >= 0,
    "Product version is required",
  );
  if (product.__v !== version)
    throw new RuleError(
      "Product changed; refresh the images and try again",
      409,
    );
};
async function sendImage(req, res, publicOnly) {
  if (
    !/^[a-f\d]{24}$/i.test(req.params.id) ||
    !/^[a-f\d]{24}$/i.test(req.params.imageId)
  )
    throw new RuleError("Image not found", 404);
  const product = await Product.findOne({
    _id: req.params.id,
    ...(publicOnly ? { active: true } : {}),
  }).lean();
  if (
    !product ||
    !product.images?.some((image) => image.id === req.params.imageId)
  )
    throw new RuleError("Image not found", 404);
  const thumb = req.path.endsWith("/thumb");
  const image = await ProductImage.findOne({
    _id: req.params.imageId,
    product: product._id,
  }).select(thumb ? "+thumbnail" : "+data");
  if (!image) throw new RuleError("Image not found", 404);
  res.set({
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": 'inline; filename="product.webp"',
    "Cache-Control": publicOnly ? "public, max-age=300" : "private, no-store",
  });
  res.send(Buffer.from(thumb ? image.thumbnail : image.data));
}
export function mountPublicProductImages(app) {
  app.get(
    [
      "/api/catalog/:id/images/:imageId",
      "/api/catalog/:id/images/:imageId/thumb",
    ],
    wrap((req, res) => sendImage(req, res, true)),
  );
}
export function mountProductImages(app) {
  app.get(
    "/api/products/:id/images",
    staff(),
    wrap(async (req, res) =>
      res.json({ product: await entity(Product, req.params.id) }),
    ),
  );
  app.get(
    [
      "/api/products/:id/images/:imageId",
      "/api/products/:id/images/:imageId/thumb",
    ],
    staff(),
    wrap((req, res) => sendImage(req, res, false)),
  );
  const upload = (replace) => [
    staff(),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: MAX_IMAGE_INPUT,
    }),
    wrap(async (req, res) => {
      const versionHeader = req.headers["x-product-version"];
      requireRule(
        typeof versionHeader === "string" && /^\d{1,9}$/.test(versionHeader),
        "X-Product-Version header required",
      );
      const version = Number(versionHeader);
      const original = await entity(Product, req.params.id);
      current(original, version);
      requireRule(
        replace
          ? original.images.some((image) => image.id === req.params.imageId)
          : original.images.length < MAX_PRODUCT_IMAGES,
        replace ? "Image not found" : "A product supports at most 8 images",
      );
      const normalized = await normalizeProductImage(
        req.body,
        req.headers["content-type"],
      );
      const product = await tx(async (session) => {
        const product = await entity(Product, req.params.id, session);
        current(product, version);
        requireRule(
          replace || product.images.length < MAX_PRODUCT_IMAGES,
          "A product supports at most 8 images",
        );
        const [stored] = await ProductImage.create(
          [
            {
              product: product.id,
              data: normalized.data,
              thumbnail: normalized.thumbnail,
            },
          ],
          { session },
        );
        const meta = {
          id: stored.id,
          width: normalized.width,
          height: normalized.height,
          size: normalized.size,
        };
        if (replace) {
          const position = product.images.findIndex(
            (image) => image.id === req.params.imageId,
          );
          requireRule(position >= 0, "Image not found");
          product.images[position] = meta;
          await ProductImage.deleteOne(
            { _id: req.params.imageId, product: product.id },
            { session },
          );
        } else product.images.push(meta);
        await product.save({ session });
        await audit(
          req,
          session,
          replace ? "product.image.replace" : "product.image.upload",
          "Product",
          product.id,
          { imageId: stored.id },
        );
        return product;
      });
      res.status(replace ? 200 : 201).json({ product });
    }),
  ];
  app.post("/api/products/:id/images", ...upload(false));
  app.post("/api/products/:id/images/:imageId/replace", ...upload(true));
  app.post(
    "/api/products/:id/images/:imageId/remove",
    staff(),
    wrap(async (req, res) => {
      const product = await tx(async (session) => {
        const product = await entity(Product, req.params.id, session);
        current(product, req.body.version);
        requireRule(
          product.images.some((image) => image.id === req.params.imageId),
          "Image not found",
        );
        product.images = product.images.filter(
          (image) => image.id !== req.params.imageId,
        );
        await ProductImage.deleteOne(
          { _id: req.params.imageId, product: product.id },
          { session },
        );
        await product.save({ session });
        await audit(
          req,
          session,
          "product.image.remove",
          "Product",
          product.id,
          { imageId: req.params.imageId },
        );
        return product;
      });
      res.json({ product });
    }),
  );
  app.patch(
    "/api/products/:id/images",
    staff(),
    wrap(async (req, res) => {
      const product = await tx(async (session) => {
        const product = await entity(Product, req.params.id, session);
        current(product, req.body.version);
        const ids = req.body.imageIds;
        requireRule(
          ids.length === product.images.length &&
            new Set(ids).size === ids.length &&
            ids.every((id) => product.images.some((image) => image.id === id)),
          "Supply every existing image exactly once",
        );
        product.images = ids.map((id) =>
          product.images.find((image) => image.id === id),
        );
        await product.save({ session });
        await audit(
          req,
          session,
          "product.images.reorder",
          "Product",
          product.id,
          { imageIds: ids },
        );
        return product;
      });
      res.json({ product });
    }),
  );
}
