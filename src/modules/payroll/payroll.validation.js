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
export const payrollSchemas = [
  ["POST", /^\/api\/employees\/[a-f\d]{24}\/advance$/, strict({ amount })],
  [
    "POST",
    /^\/api\/employees\/[a-f\d]{24}\/salary$/,
    strict({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      deduction: zeroAmount,
    }),
  ],
];

payrollSchemas.push(
  [
    "POST",
    /^\/api\/records\/employee$/,
    strict({ name: text, job: optional, salary: amount }),
  ],
  [
    "PATCH",
    /^\/api\/records\/employee\/[a-f\d]{24}$/,
    strict({
      name: optional,
      job: optional,
      salary: amount.optional(),
      active: bool.optional(),
    }),
  ],
);
