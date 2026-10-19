import { z } from "zod";
import {
  text,
  note,
  oid,
  bool,
  optional,
  amount,
  zeroAmount,
  qty,
  email,
  password,
  strict,
  journalLine,
} from "../../shared/validation.js";
export const catalogSchemas = [
  [
    "POST",
    /^\/api\/records\/product$/,
    strict({
      name: strict({ en: text, ps: optional, fa: optional }),
      category: optional,
      grade: optional,
      origin: optional,
      packaging: optional,
      moq: z.union([qty, z.literal(0)]).default(0),
    }),
  ],
  [
    "PATCH",
    /^\/api\/records\/product\/[a-f\d]{24}$/,
    strict({
      name: strict({ en: text, ps: optional, fa: optional }).optional(),
      category: optional,
      grade: optional,
      origin: optional,
      packaging: optional,
      moq: z.union([qty, z.literal(0)]).optional(),
      active: bool.optional(),
    }),
  ],
];
