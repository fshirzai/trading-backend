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
export const returnsSchemas = [
  ["POST", /^\/api\/returns\/[a-f\d]{24}\/reject$/, strict({ reason: note })],
  ["POST", /^\/api\/orders\/[a-f\d]{24}\/returns$/, strict({ reason: note })],
  [
    "POST",
    /^\/api\/returns\/[a-f\d]{24}\/complete$/,
    strict({
      inspectionPassed: bool,
      refundConfirmed: bool,
      returnedQuantity: z.union([qty, z.literal(0)]).default(0),
      warehouse: oid.optional(),
      note,
    }),
  ],
];
