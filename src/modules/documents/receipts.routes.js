import express from "express";
import { createHash } from "node:crypto";
import { Document } from "../../models.js";
import {
  wrap,
  roles,
  ownOrder,
  entity,
  tx,
  audit,
} from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
import { normalizeProductImage } from "../catalog/product-images.service.js";
export function mountReceipts(app) {
  app.post(
    "/api/orders/:id/receipts",
    roles("admin", "manager", "seller", "customer"),
    express.raw({
      type: ["image/jpeg", "image/png", "image/webp"],
      limit: "3mb",
    }),
    wrap(async (req, res) => {
      const order = await ownOrder(req, req.params.id);
      requireRule(
        order.acceptedAt &&
          !["Refunded", "Return requested"].includes(order.status),
        "Accepted open order required",
      );
      const image = await normalizeProductImage(
        req.body,
        req.headers["content-type"],
      );
      const out = await tx(async (s) => {
        const o = await ownOrder(req, order.id, s);
        requireRule(
          !["Refunded", "Return requested"].includes(o.status),
          "Order closed",
        );
        const [doc] = await Document.create(
          [
            {
              owner: req.user.id,
              order: o.id,
              kind: "payment-receipt",
              name: "TT-receipt.webp",
              mime: "image/webp",
              size: image.data.length,
              data: image.data,
              normalized: true,
              status: "Clean",
              sha256: createHash("sha256").update(image.data).digest("hex"),
            },
          ],
          { session: s },
        );
        await audit(req, s, "receipt.upload", "Document", doc.id);
        return { id: doc.id, status: doc.status };
      });
      res.status(201).json(out);
    }),
  );
  app.get(
    "/api/receipts/:id",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const doc = await entity(Document, req.params.id);
      await ownOrder(req, String(doc.order));
      requireRule(
        doc.normalized &&
          doc.kind === "payment-receipt" &&
          doc.status === "Clean",
        "Receipt unavailable",
      );
      const stored = await Document.findById(doc.id).select("+data");
      requireRule(stored?.data, "Receipt unavailable");
      res.set({
        "Content-Type": "image/webp",
        "Content-Disposition": 'attachment; filename="TT-receipt.webp"',
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      });
      res.send(Buffer.from(stored.data));
    }),
  );
}
