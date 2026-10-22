import { z } from "zod";
import { strict, oid, note } from "../../shared/validation.js";
export const upgradeSchemas = [
  ["POST", /^\/api\/orders\/[a-f\d]{24}\/invoices$/, strict({})],
  ["POST", /^\/api\/notification-delivery\/[a-f\d]{24}\/retry$/, strict({})],
  ["POST", /^\/api\/orders\/[a-f\d]{24}\/reserve$/, strict({})],
  [
    "POST",
    /^\/api\/orders\/[a-f\d]{24}\/procurement-requests$/,
    strict({ item: z.string().max(30).optional(), note: note.optional() }),
  ],
  [
    "POST",
    /^\/api\/products\/[a-f\d]{24}\/video$/,
    strict({
      size: z
        .number()
        .int()
        .min(12)
        .max(30 * 1024 * 1024),
      mime: z.enum(["video/mp4", "video/webm"]),
    }),
  ],
  [
    "POST",
    /^\/api\/products\/[a-f\d]{24}\/video\/[a-f\d]{24}\/complete$/,
    strict({}),
  ],
  ["POST", /^\/api\/products\/[a-f\d]{24}\/video\/remove$/, strict({})],
];
