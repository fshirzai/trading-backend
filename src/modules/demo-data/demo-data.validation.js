import { z } from "zod";
import { strict, password } from "../../shared/validation.js";
export const demoDataSchemas = [
  [
    "POST",
    /^\/api\/admin\/demo-data$/,
    strict({
      adminPassword: z.string().min(1).max(128),
      demoPassword: password,
      confirmation: z.literal("ADD DEMO DATA"),
    }),
  ],
];
