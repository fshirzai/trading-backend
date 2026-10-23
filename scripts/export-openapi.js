import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { schemas } from "../src/validation.js";
const target = new URL("../openapi.json", import.meta.url);
const doc = JSON.parse(await readFile(target, "utf8"));
doc.info.version = "2.6.0";
const extra = [
  ["GET", "/api/admin/demo-data"],
  ["POST", "/api/admin/demo-data"],
  ["PATCH", "/api/me/profile"],
  ["POST", "/api/me/avatar/remove"],
  ["POST", "/api/auth/sessions/{id}/revoke"],
  ["PATCH", "/api/admin/settings"],
  ["POST", "/api/admin/settings/logo/remove"],
  ["PUT", "/api/admin/settings/hesabpay"],
  ["POST", "/api/orders/{id}/hesabpay-checkout"],
  ["GET", "/api/catalog"],
  ["GET", "/api/catalog/filters"],
  ["GET", "/api/catalog/{id}"],
  ["GET", "/api/settings/public"],
  ["GET", "/api/settings/logo/{version}"],
  ["GET", "/api/settings/photos/{id}"],
  ["GET", "/api/me/profile"],
  ["GET", "/api/me/avatar/{version}"],
  ["GET", "/api/auth/sessions"],
  ["GET", "/api/admin/settings"],
  ["GET", "/api/admin/settings/hesabpay"],
  ["GET", "/api/products/{id}/video-info"],
  ["GET", "/api/products/{id}/video"],
];
const pairs = [
  ...Object.entries(doc.paths).flatMap(([p, ops]) =>
    Object.keys(ops)
      .filter((m) => ["get", "post", "patch", "put"].includes(m))
      .map((m) => [m.toUpperCase(), p]),
  ),
  ...extra,
];
for (const [method, path] of pairs) {
  const existing = doc.paths[path]?.[method.toLowerCase()];
  const spec = schemas.find(
    ([m, re]) =>
      m === method && re.test(path.replaceAll("{id}", "a".repeat(24))),
  );
  const operation = existing || {
    summary: method + " " + path,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          "Successful operation; API.md documents the response and domain constraints.",
      },
    },
  };
  if (
    path.startsWith("/api/catalog") ||
    path === "/api/settings/public" ||
    path.startsWith("/api/settings/logo/") ||
    path.startsWith("/api/settings/photos/")
  )
    operation.security = [];
  const params = [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  if (params.length) operation.parameters = params;
  if (path === "/api/catalog")
    operation.parameters = [
      "search",
      "category",
      "origin",
      "grade",
      "cursor",
      "limit",
    ].map((name) => ({ name, in: "query", schema: { type: "string" } }));
  if (spec)
    operation.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: z.toJSONSchema(spec[2], {
            io: "input",
            unrepresentable: "any",
          }),
        },
      },
    };
  (doc.paths[path] ??= {})[method.toLowerCase()] = operation;
}
for (const path of [
  "/api/me/avatar",
  "/api/admin/settings/logo",
  "/api/admin/settings/photos",
])
  doc.paths[path] = {
    post: {
      summary: "Upload normalized image (maximum 3 MiB)",
      security: [{ bearerAuth: [] }],
      ...(path.includes("/admin/")
        ? {
            parameters: [
              {
                in: "header",
                name: "X-Settings-Revision",
                required: true,
                schema: { type: "integer", minimum: 0 },
              },
            ],
          }
        : {}),
      requestBody: {
        required: true,
        content: Object.fromEntries(
          ["image/jpeg", "image/png", "image/webp"].map((type) => [
            type,
            { schema: { type: "string", format: "binary" } },
          ]),
        ),
      },
      responses: {
        201: { description: "Updated profile or public company settings" },
        422: { description: "Invalid image or fields" },
      },
    },
  };

const callbackSchema = {
  type: "object",
  required: ["signature", "timestamp", "user_id"],
  properties: {
    signature: { type: "string" },
    timestamp: { type: "string" },
    user_id: { type: "string" },
    transaction_id: { type: "string" },
    amount: { type: "number" },
    success: { type: "boolean" },
    status_code: { type: "integer" },
    items: { type: "array", items: { type: "object" } },
  },
};
doc.paths["/api/webhooks/hesabpay/{account}/{secret}"] = {
  post: {
    summary:
      "Private HesabPay callback; remote signature verification and exact attempt matching required",
    security: [],
    parameters: ["account", "secret"].map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    })),
    requestBody: {
      required: true,
      content: { "application/json": { schema: callbackSchema } },
    },
    responses: {
      200: { description: "Processed or ignored verified event" },
      400: { description: "Invalid callback, signature, amount or reference" },
    },
  },
};
await writeFile(target, JSON.stringify(doc, null, 2) + "\n");
console.log("OpenAPI request contracts updated for 2.6.0");
