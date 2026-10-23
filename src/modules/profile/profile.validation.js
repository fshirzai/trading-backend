import { z } from "zod";
import { strict, text } from "../../shared/validation.js";
export const profileSchemas = [
  [
    "PATCH",
    /^\/api\/me\/profile$/,
    strict({
      name: text,
      phone: z.string().trim().max(80),
      country: z.string().trim().max(120),
      address: z.string().trim().max(1000),
    }),
  ],
  ["POST", /^\/api\/me\/avatar\/remove$/, strict({})],
  ["POST", /^\/api\/auth\/sessions\/[a-f\d]{24}\/revoke$/, strict({})],
];
