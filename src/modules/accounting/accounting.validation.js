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
export const accountingSchemas = [
  [
    "POST",
    /^\/api\/journals$/,
    strict({ memo: note, lines: z.array(journalLine).min(2).max(100) }),
  ],
  ["POST", /^\/api\/journals\/[a-f\d]{24}\/reverse$/, strict({})],
  [
    "POST",
    /^\/api\/accounting\/periods\/close$/,
    strict({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  ],
];
accountingSchemas.push(
  [
    "POST",
    /^\/api\/accounting\/accounts$/,
    strict({
      code: z.string().regex(/^\d{4,6}$/),
      name: text,
      type: z.enum(["asset", "liability", "equity", "income", "expense"]),
    }),
  ],
  [
    "POST",
    /^\/api\/accounting\/expenses$/,
    strict({
      amount,
      category: text,
      memo: note,
      reference: text,
      order: oid.optional(),
    }),
  ],
);

accountingSchemas.push([
  "POST",
  /^\/api\/accounting\/fiscal-close$/,
  strict({ year: z.number().int().min(2000).max(2100) }),
]);
