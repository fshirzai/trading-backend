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
export const salesSchemas = [
  [
    "POST",
    /^\/api\/inquiries$/,
    strict({
      customer: oid.optional(),
      product: oid,
      quantity: qty,
      destination: optional,
      items: z
        .array(strict({ product: oid, quantity: qty }))
        .min(1)
        .max(30)
        .optional(),
      preferredPayment: z.enum(["TT", "VISA"]).default("TT"),
      source: z
        .enum(["website", "whatsapp", "phone", "office"])
        .default("website"),
    }),
  ],
  [
    "POST",
    /^\/api\/inquiries\/[a-f\d]{24}\/proforma$/,
    strict({
      items: z
        .array(strict({ product: oid, quantity: qty, productTotal: amount }))
        .min(1)
        .max(30)
        .optional(),
      productTotal: amount,
      deliveryFees: zeroAmount,
      border: text,
      splitIncluded: bool.default(false),
    }),
  ],
  [
    "POST",
    /^\/api\/orders\/[a-f\d]{24}\/revise$/,
    strict({
      items: z
        .array(strict({ product: oid, quantity: qty, productTotal: amount }))
        .min(1)
        .max(30)
        .optional(),
      productTotal: amount,
      deliveryFees: zeroAmount,
      border: text,
      splitIncluded: bool.default(false),
      reason: note,
    }),
  ],
  [
    "POST",
    /^\/api\/orders\/[a-f\d]{24}\/accept$/,
    strict({ acceptanceEvidence: note.optional() }),
  ],
];
