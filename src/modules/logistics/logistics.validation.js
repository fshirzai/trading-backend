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
export const logisticsSchemas = [
  [
    "POST",
    /^\/api\/orders\/[a-f\d]{24}\/shipments$/,
    strict({
      item: z.string().max(30).optional(),
      quantity: qty,
      direct: bool.default(false),
      sourceBorder: optional,
      warehouse: oid.optional(),
      driver: text,
      phone: optional,
      vehicle: text,
      additionalFee: zeroAmount,
      feeAccepted: bool.default(false),
      acceptanceEvidence: note.optional(),
      directCost: amount.optional(),
    }),
  ],
  [
    "POST",
    /^\/api\/shipments\/[a-f\d]{24}\/handover$/,
    strict({ recipient: text, proof: note }),
  ],
];
