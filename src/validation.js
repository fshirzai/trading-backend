import { demoDataSchemas } from "./modules/demo-data/demo-data.validation.js";
import { hesabSchemas } from "./modules/payments/hesabpay.validation.js";
import { profileSchemas } from "./modules/profile/profile.validation.js";
import { settingsSchemas } from "./modules/settings/settings.validation.js";
import { upgradeSchemas } from "./modules/platform/upgrade.validation.js";
import { catalogSchemas } from "./modules/catalog/catalog.validation.js";
import { contactsSchemas } from "./modules/contacts/contacts.validation.js";
import { z } from "zod";
import { RuleError } from "./shared/rules.js";
import { strict, oid } from "./shared/validation.js";
import { authSchemas } from "./modules/auth/auth.validation.js";
import { salesSchemas } from "./modules/sales/sales.validation.js";
import { returnsSchemas } from "./modules/returns/returns.validation.js";
import { paymentsSchemas } from "./modules/payments/payments.validation.js";
import { procurementSchemas } from "./modules/procurement/procurement.validation.js";
import { inventorySchemas } from "./modules/inventory/inventory.validation.js";
import { logisticsSchemas } from "./modules/logistics/logistics.validation.js";
import { accountingSchemas } from "./modules/accounting/accounting.validation.js";
import { payrollSchemas } from "./modules/payroll/payroll.validation.js";
import { documentsSchemas } from "./modules/documents/documents.validation.js";
import { reconciliationSchemas } from "./modules/reconciliation/reconciliation.validation.js";
import { notificationsSchemas } from "./modules/notifications/notifications.validation.js";
export const schemas = [
  ...demoDataSchemas,
  ...hesabSchemas,
  ...profileSchemas,
  ...settingsSchemas,
  ...upgradeSchemas,
  ...notificationsSchemas,
  ...reconciliationSchemas,
  ...authSchemas,
  ...catalogSchemas,
  ...contactsSchemas,
  ...salesSchemas,
  ...returnsSchemas,
  ...paymentsSchemas,
  ...procurementSchemas,
  ...inventorySchemas,
  ...logisticsSchemas,
  ...accountingSchemas,
  ...payrollSchemas,
  ...documentsSchemas,
];

const querySchema = strict({
  category: z.string().trim().max(100).optional(),
  origin: z.string().trim().max(100).optional(),
  grade: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).optional(),
  status: z.string().max(60).optional(),
  warehouse: oid.optional(),
  product: oid.optional(),
  order: oid.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .refine((x) => +x >= 1 && +x <= 100)
    .optional(),
  cursor: oid.optional(),
});
export function validateRequest(req, res, next) {
  try {
    if (req.path === "/api/jobs/notifications" && req.method === "POST")
      return next();
    if (req.url.length > 2048) throw new RuleError("URL too long", 414);
    const query = req.path.startsWith("/api/reports/")
      ? strict({
          from: z.string().date().optional(),
          to: z.string().date().optional(),
        })
      : querySchema;
    if (!query.safeParse(req.query).success)
      throw new RuleError("Invalid query parameters", 400);
    if (["POST", "PATCH", "PUT"].includes(req.method)) {
      if (
        req.method === "POST" &&
        [
          "/api/me/avatar",
          "/api/admin/settings/logo",
          "/api/admin/settings/photos",
        ].includes(req.path)
      )
        return next();
      if (
        req.method === "POST" &&
        /^\/api\/products\/[a-f\d]{24}\/images(?:\/[a-f\d]{24}\/replace)?$/.test(
          req.path,
        )
      )
        return next();
      if (
        /^\/api\/products\/[a-f\d]{24}\/video\/[a-f\d]{24}\/chunks$/.test(
          req.path,
        ) ||
        /^\/api\/orders\/[a-f\d]{24}\/receipts$/.test(req.path)
      )
        return next();
      if (/^\/api\/orders\/[a-f\d]{24}\/documents$/.test(req.path))
        return next();
      const spec = schemas.find(
        ([method, re]) => req.method === method && re.test(req.path),
      );
      if (!spec) throw new RuleError("Unknown endpoint", 404);
      const result = spec[2].safeParse(req.body || {});
      if (!result.success) {
        const e = new RuleError("Invalid request fields", 422);
        e.details = result.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        }));
        throw e;
      }
      req.body = result.data;
    }
    next();
  } catch (e) {
    next(e);
  }
}
