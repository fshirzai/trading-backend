import { z } from "zod";
import { strict, amount, note } from "../../shared/validation.js";
export const hesabSchemas = [
  [
    "PUT",
    /^\/api\/admin\/settings\/hesabpay$/,
    strict({
      revision: z.number().int().nonnegative(),
      label: z.string().trim().min(1).max(120),
      environment: z.enum(["sandbox", "production"]),
      apiKey: z
        .string()
        .trim()
        .min(16)
        .max(500)
        .refine((x) => !/[\r\n]/.test(x))
        .optional(),
      afnPerUsd: z
        .number()
        .positive()
        .max(10000)
        .refine(
          (x) =>
            Number.isSafeInteger(Math.round(x * 1e6)) &&
            Math.round(x * 1e6) > 0 &&
            Math.abs(x * 1e6 - Math.round(x * 1e6)) < 1e-5,
        ),
      enabled: z.boolean(),
      merchantApproved: z.boolean(),
    }),
  ],
  [
    "POST",
    /^\/api\/orders\/[a-f\d]{24}\/hesabpay-checkout$/,
    strict({
      amount,
      expectedAfnMinor: z.number().int().positive().safe(),
      expectedAccount: z.string().regex(/^[a-f\d]{24}$/),
    }),
  ],
];
