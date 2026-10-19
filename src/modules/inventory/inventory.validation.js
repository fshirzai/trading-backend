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
export const inventorySchemas = [
  [
    "POST",
    /^\/api\/stock\/transfer$/,
    strict({ batch: oid, warehouse: oid, quantity: qty }),
  ],
];

inventorySchemas.push(
  [
    "POST",
    /^\/api\/records\/warehouse$/,
    strict({ name: text, country: optional, address: note.optional() }),
  ],
  [
    "PATCH",
    /^\/api\/records\/warehouse\/[a-f\d]{24}$/,
    strict({
      name: optional,
      country: optional,
      address: note.optional(),
      active: bool.optional(),
    }),
  ],
);
