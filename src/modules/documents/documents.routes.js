import express from "express";
import { scanFile } from "./scanner.service.js";
import path from "node:path";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Document } from "../../models.js";
import {
  wrap,
  ownOrder,
  entity,
  roles,
  tx,
  audit,
} from "../../shared/services.js";
import { requireRule, RuleError } from "../../shared/rules.js";
function detected(b) {
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  return null;
}
const file = (config, id) => path.join(config.uploadDir, String(id));
export function mountDocuments(app, config) {
  app.post(
    "/api/orders/:id/documents",
    roles("admin", "manager", "seller", "customer"),
    express.raw({
      type: ["application/pdf", "image/png", "image/jpeg"],
      limit: "5mb",
    }),
    wrap(async (req, res) => {
      const o = await ownOrder(req, req.params.id);
      requireRule(
        !["Refunded", "Cancelled"].includes(o.status),
        "Order closed",
      );
      requireRule(
        Buffer.isBuffer(req.body) && req.body.length > 0,
        "PDF, PNG or JPEG body required",
      );
      const mime = detected(req.body);
      requireRule(
        mime && mime === req.headers["content-type"],
        "File signature does not match content type",
      );
      const name = req.headers["x-document-name"],
        kind = req.headers["x-document-kind"] || "payment-receipt";
      requireRule(
        typeof name === "string" &&
          name.length <= 150 &&
          !/[\r\n\\/]/.test(name),
        "Safe document name required",
      );
      requireRule(
        ["payment-receipt", "trade-document"].includes(kind),
        "Invalid document category",
      );
      if (req.user.role === "customer")
        requireRule(
          kind === "payment-receipt",
          "Customers upload receipts only",
        );
      await mkdir(config.uploadDir, { recursive: true, mode: 0o700 });
      const doc = new Document({
        owner: req.user.id,
        order: o.id,
        kind,
        name,
        mime,
        size: req.body.length,
        sha256: createHash("sha256").update(req.body).digest("hex"),
      });
      const target = file(config, doc.id);
      await writeFile(target, req.body, { flag: "wx", mode: 0o600 });
      try {
        await tx(async (s) => {
          await doc.save({ session: s });
          await audit(req, s, "document.upload", "Document", doc.id);
        });
      } catch (e) {
        await unlink(target).catch(() => {});
        throw e;
      }
      res.status(201).json({ id: doc.id, status: doc.status });
    }),
  );
  app.post(
    "/api/documents/:id/scan",
    roles("admin"),
    wrap(async (req, res) => {
      const doc = await entity(Document, req.params.id);
      requireRule(doc.status === "Quarantined", "Document already scanned");
      const buffer = await readFile(file(config, doc.id));
      requireRule(
        createHash("sha256").update(buffer).digest("hex") === doc.sha256,
        "Document integrity failure",
      );
      const result = await scanFile(buffer, config);
      doc.status = result.clean ? "Clean" : "Rejected";
      await tx(async (s) => {
        await doc.save({ session: s });
        await audit(req, s, "document.scan", "Document", doc.id, {
          status: doc.status,
          scanner: result.engine,
        });
      });
      res.json({ id: doc.id, status: doc.status });
    }),
  );
  app.get(
    "/api/documents/:id",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const doc = await entity(Document, req.params.id);
      await ownOrder(req, doc.order);
      requireRule(
        doc.status === "Clean",
        "Document is not cleared for download",
      );
      const buffer = await readFile(file(config, doc.id));
      if (createHash("sha256").update(buffer).digest("hex") !== doc.sha256)
        throw new RuleError("Document integrity failure", 500);
      res.setHeader("Content-Type", doc.mime);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="download.${doc.mime === "application/pdf" ? "pdf" : doc.mime === "image/png" ? "png" : "jpg"}"`,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buffer);
    }),
  );
}
