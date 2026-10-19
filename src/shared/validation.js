import { z } from "zod";

export const text = z.string().trim().min(1).max(200),
  note = z.string().trim().min(1).max(2000),
  oid = z.string().regex(/^[a-f\d]{24}$/i),
  bool = z.boolean(),
  optional = text.optional();
export const amount = z
  .number()
  .finite()
  .positive()
  .max(1000000000)
  .refine(
    (x) => Math.abs(x * 100 - Math.round(x * 100)) < 1e-6,
    "At most two decimal places",
  );
export const zeroAmount = z.union([amount, z.literal(0)]).default(0);
export const qty = z
  .number()
  .finite()
  .positive()
  .max(1000000)
  .refine(
    (x) => Math.abs(x * 1000 - Math.round(x * 1000)) < 1e-6,
    "At most three decimal places",
  );
export const email = z.string().trim().toLowerCase().email().max(254),
  password = z
    .string()
    .min(12)
    .max(128)
    .refine((x) => Buffer.byteLength(x) <= 256);
export const strict = (s) => z.object(s).strict();
export const journalLine = strict({
  account: text,
  debitCents: z.number().int().min(0).max(100000000000),
  creditCents: z.number().int().min(0).max(100000000000),
});
