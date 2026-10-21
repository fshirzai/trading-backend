import { mountWorkspace } from "./modules/workspace/workspace.routes.js";
import express from "express";
import {
  mountPublicProductImages,
  mountProductImages,
} from "./modules/catalog/product-images.routes.js";
import { mountFiscalClose } from "./modules/accounting/fiscal-close.routes.js";
import { mountCardRefunds } from "./modules/payments/refunds.routes.js";
import { mountNotifications } from "./modules/notifications/notifications.routes.js";
import { mountAccountingExtensions } from "./modules/accounting/extensions.routes.js";
import { mountGeneratedDocuments } from "./modules/documents/generated-documents.routes.js";
import {
  mountGatewayWebhook,
  mountGatewayRoutes,
} from "./modules/payments/gateway.routes.js";
import { mountReconciliation } from "./modules/reconciliation/reconciliation.routes.js";
import { mountMaintenance } from "./maintenance.js";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { validateRequest } from "./validation.js";
import { mountAuth } from "./modules/auth/auth.routes.js";
import { mountOperations } from "./operations.js";
import { mountAccounting } from "./modules/accounting/accounting.routes.js";
import { mountDocuments } from "./modules/documents/documents.routes.js";
import { MongoRateStore } from "./modules/platform/rate-limit.store.js";
import { RuleError } from "./shared/rules.js";
export async function createApp(config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(helmet());
  app.use((req, res, next) => {
    if (
      config.mode === "production" &&
      !req.secure &&
      !/^\/api\/health\/(live|ready)$/.test(req.path)
    )
      return next(new RuleError("HTTPS required", 426));
    next();
  });
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || config.origins.includes(origin)) cb(null, true);
        else cb(new RuleError("Origin not allowed", 403));
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "X-Product-Version",
        "Content-Type",
        "Authorization",
        "X-Document-Name",
        "X-Document-Kind",
        "Idempotency-Key",
      ],
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 150,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      store: new MongoRateStore("api"),
      message: { error: "Too many requests" },
    }),
  );
  mountGatewayWebhook(app, config);
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use(validateRequest);
  app.get("/api/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/api/health/ready", (req, res) =>
    mongoose.connection.readyState === 1
      ? res.json({ status: "ready" })
      : res.status(503).json({ status: "unavailable" }),
  );
  app.get("/api/catalog", async (req, res, next) => {
    try {
      const { Product } = await import("./models.js");
      const { list } = await import("./shared/services.js");
      res.json(await list(Product, { active: true }, req.query));
    } catch (e) {
      next(e);
    }
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new MongoRateStore("auth"),
    message: { error: "Too many authentication attempts" },
  });
  mountPublicProductImages(app);
  await mountAuth(app, config, authLimiter);
  mountProductImages(app);
  mountOperations(app, config);
  mountWorkspace(app);
  mountNotifications(app);
  mountAccounting(app);
  mountAccountingExtensions(app, config);
  mountFiscalClose(app);
  mountMaintenance(app);
  mountDocuments(app, config);
  mountGeneratedDocuments(app, config);
  mountReconciliation(app, config);
  mountGatewayRoutes(app, config);
  mountCardRefunds(app, config);
  app.use((req, res, next) => next(new RuleError("Endpoint not found", 404)));
  app.use((err, req, res, next) => {
    let status = 500,
      error = "Operation failed";
    if (err instanceof RuleError) {
      status = err.status;
      error = err.message;
    } else if (err.code === 11000 || err.name === "VersionError") {
      status = 409;
      error = "Duplicate record or concurrent operation conflict";
    } else if (
      ["ValidationError", "StrictModeError", "CastError"].includes(err.name)
    ) {
      status = 422;
      error = "Invalid record fields";
    } else if (err.type === "entity.too.large") {
      status = 413;
      error = "Request body too large";
    } else if (err.type === "entity.parse.failed") {
      status = 400;
      error = "Invalid JSON";
    }
    if (status === 500 && config.mode !== "test")
      console.error(
        JSON.stringify({
          level: "error",
          requestId: req.requestId,
          type: err.name,
        }),
      );
    res.status(status).json({
      error,
      requestId: req.requestId,
      ...(err.details ? { details: err.details } : {}),
    });
  });
  return app;
}

// Vercel detects src/app.js and requires a default request handler.
// Render and local startup continue to call the named createApp factory.
export default async function handler(req, res) {
  const { default: vercelHandler } =
    await import("./modules/platform/vercel.runtime.js");
  return vercelHandler(req, res);
}
