import { z } from "zod";
import { strict, text, oid } from "../../shared/validation.js";
export const reconciliationSchemas = [
  [
    "POST",
    /^\/api\/reconciliation\/statements$/,
    strict({
      name: text,
      account: z.enum(["Bank", "Cash"]),
      openingCents: z.number().int().safe(),
      closingCents: z.number().int().safe(),
      csv: z.string().min(1).max(90000),
    }),
  ],
  [
    "POST",
    /^\/api\/reconciliation\/lines\/[a-f\d]{24}\/match$/,
    strict({ journal: oid }),
  ],
  [
    "POST",
    /^\/api\/reconciliation\/statements\/[a-f\d]{24}\/close$/,
    strict({}),
  ],
];
