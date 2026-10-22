import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { Idempotency } from "../../models.js";
import { RuleError } from "../../shared/rules.js";
export const operationContext = new AsyncLocalStorage();
function canonical(x) {
  if (Array.isArray(x)) return "[" + x.map(canonical).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
const required =
  /^\/api\/(payments\/[^/]+\/verify|orders\/[^/]+\/shipments|shipments\/[^/]+\/handover|returns\/[^/]+\/complete|employees\/[^/]+\/(salary|advance)|journals(?:\/[^/]+\/reverse)?|purchases\/[^/]+\/pay)$/;
export function idempotencyMiddleware(req, res, next) {
  if (
    req.method !== "POST" ||
    /\/(receipts|chunks)$/.test(req.originalUrl.split("?")[0]) ||
    /^\/api\/products\/[a-f\d]{24}\/images(?:\/|$)/.test(req.originalUrl) ||
    /\/(checkout|card-refunds)$/.test(req.originalUrl) ||
    req.originalUrl.startsWith("/api/auth/") ||
    req.originalUrl === "/api/users" ||
    req.originalUrl.startsWith("/api/documents/") ||
    /^\/api\/orders\/[a-f\d]{24}\/documents(?:\?|$)/.test(req.originalUrl)
  )
    return next();
  const endpoint = req.originalUrl.split("?")[0];
  const raw = req.headers["idempotency-key"];
  if (!raw) {
    if (required.test(endpoint))
      return next(new RuleError("Idempotency-Key header required", 400));
    return next();
  }
  if (!/^[A-Za-z\d_-]{16,100}$/.test(raw))
    return next(new RuleError("Invalid Idempotency-Key", 400));
  const key = createHash("sha256")
      .update(req.user.id + "|" + endpoint + "|" + raw)
      .digest("hex"),
    fingerprint = createHash("sha256")
      .update(canonical(req.body))
      .digest("hex");
  const created =
    /\/records\/|\/inquiries$|\/proforma$|\/payments$|\/shipments$|\/returns$|\/purchases$|\/journals$|\/salary$|\/pay$|\/users$|\/periods\/close$/.test(
      endpoint,
    );
  Idempotency.findOne({ key, expiresAt: { $gt: new Date() } })
    .lean()
    .then((prior) => {
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new RuleError(
            "Idempotency key reused with different request",
            409,
          );
        return res.status(prior.status).json(prior.response);
      }
      operationContext.run(
        { key, fingerprint, status: created ? 201 : 200 },
        next,
      );
    })
    .catch(next);
}
