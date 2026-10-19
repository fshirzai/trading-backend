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
export const contactsSchemas = [
  [
    "POST",
    /^\/api\/records\/party$/,
    strict({
      name: text,
      type: z.enum(["customer", "supplier"]),
      country: optional,
      email: email.optional(),
      phone: optional,
      address: note.optional(),
    }),
  ],
];
