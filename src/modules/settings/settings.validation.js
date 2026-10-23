import { z } from "zod";
import { strict } from "../../shared/validation.js";
const clean = (max) => z.string().trim().max(max);
const safeWebsite = z.union([
  z.literal(""),
  z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((s) => {
      const u = new URL(s);
      return u.protocol === "https:" && !u.username && !u.password;
    }, "Use an HTTPS website without credentials"),
]);
export const settingsSchemas = [
  [
    "PATCH",
    /^\/api\/admin\/settings$/,
    strict({
      translations: z
        .object({
          ps: z
            .object({
              aboutTitle: clean(200).optional(),
              aboutBody: clean(12000).optional(),
              termsBody: clean(12000).optional(),
              privacyBody: clean(12000).optional(),
              deliveryBody: clean(12000).optional(),
            })
            .strict(),
          fa: z
            .object({
              aboutTitle: clean(200).optional(),
              aboutBody: clean(12000).optional(),
              termsBody: clean(12000).optional(),
              privacyBody: clean(12000).optional(),
              deliveryBody: clean(12000).optional(),
            })
            .strict(),
        })
        .strict()
        .optional(),
      termsBody: clean(12000).optional(),
      privacyBody: clean(12000).optional(),
      deliveryBody: clean(12000).optional(),
      aboutImages: z
        .array(
          z
            .object({
              id: z.string().regex(/^(?:starter-(?:field|grain)|[a-f\d]{24})$/),
              alt: clean(200),
            })
            .strict(),
        )
        .max(4)
        .refine(
          (images) => new Set(images.map((x) => x.id)).size === images.length,
          "Duplicate About photo",
        )
        .optional(),
      revision: z.number().int().nonnegative(),
      name: clean(120)
        .min(1)
        .refine((s) => !/[\r\n]/.test(s)),
      tagline: clean(240),
      aboutTitle: clean(200),
      aboutBody: clean(12000),
      contactEmail: z.union([
        z.literal(""),
        z.string().trim().email().max(254),
      ]),
      contactPhone: clean(80),
      address: clean(1000),
      workingHours: clean(240),
      website: safeWebsite,
    }),
  ],
  [
    "POST",
    /^\/api\/admin\/settings\/logo\/remove$/,
    strict({ revision: z.number().int().nonnegative() }),
  ],
];
