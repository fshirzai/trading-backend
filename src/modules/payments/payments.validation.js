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
export const paymentsSchemas = [
  [
    "POST",
    /^\/api\/returns\/[a-f\d]{24}\/card-refunds$/,
    strict({ payment: oid, amount, inspectionPassed: bool }),
  ],
  ["POST", /^\/api\/orders\/[a-f\d]{24}\/checkout$/, strict({ amount })],
  [
    "POST",
    /^\/api\/orders\/[a-f\d]{24}\/payments$/,
    strict({
      amount,
      method: z.literal("TT"),
      reference: text,
      receiptKey: oid.optional(),
    }),
  ],
  [
    "POST",
    /^\/api\/payments\/[a-f\d]{24}\/verify$/,
    strict({ bankFundsConfirmed: bool }),
  ],
];
