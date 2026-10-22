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
export const procurementSchemas = [
  [
    "POST",
    /^\/api\/purchases$/,
    strict({
      supplier: oid,
      product: oid,
      quantity: qty,
      totalCost: amount,
      request: oid.optional(),
    }),
  ],
  [
    "POST",
    /^\/api\/purchases\/[a-f\d]{24}\/receive$/,
    strict({ warehouse: oid, batchCode: text, location: optional }),
  ],
  [
    "POST",
    /^\/api\/purchases\/[a-f\d]{24}\/pay$/,
    strict({ amount, reference: text }),
  ],
];
