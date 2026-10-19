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
export const authSchemas = [
  [
    "POST",
    /^\/api\/auth\/verify-email$/,
    strict({ token: z.string().regex(/^[a-f\d]{64}$/) }),
  ],
  [
    "POST",
    /^\/api\/auth\/(resend-verification|forgot-password)$/,
    strict({ email }),
  ],
  [
    "POST",
    /^\/api\/auth\/reset-password$/,
    strict({ token: z.string().regex(/^[a-f\d]{64}$/), password }),
  ],
  ["POST", /^\/api\/auth\/mfa\/enroll$/, strict({ password })],
  [
    "POST",
    /^\/api\/auth\/mfa\/confirm$/,
    strict({ code: z.string().regex(/^\d{6}$/) }),
  ],
  [
    "POST",
    /^\/api\/auth\/mfa\/disable$/,
    strict({ password, code: z.string().min(6).max(24) }),
  ],
  [
    "POST",
    /^\/api\/auth\/register$/,
    strict({ name: text, email, password, country: optional }),
  ],
  [
    "POST",
    /^\/api\/auth\/login$/,
    strict({
      email,
      password: z.string().min(1).max(256),
      mfaCode: z
        .string()
        .regex(/^(\d{6}|[a-f\d]{24})$/)
        .optional(),
    }),
  ],
  ["POST", /^\/api\/auth\/(refresh|logout|logout-all)$/, strict({})],
  [
    "POST",
    /^\/api\/users$/,
    strict({
      name: text,
      email,
      password,
      role: z.enum(["manager", "seller", "procurement"]),
    }),
  ],
  [
    "PATCH",
    /^\/api\/users\/[a-f\d]{24}$/,
    strict({
      active: bool.optional(),
      role: z.enum(["manager", "seller", "procurement", "customer"]).optional(),
    }).refine((x) => Object.keys(x).length > 0),
  ],
];

authSchemas.push([
  "POST",
  /^\/api\/auth\/change-password$/,
  strict({
    oldPassword: password,
    newPassword: password,
    mfaCode: z.string().min(6).max(24).optional(),
  }),
]);
