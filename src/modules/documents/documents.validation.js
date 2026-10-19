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
export const documentsSchemas = [
  ["POST", /^\/api\/documents\/[a-f\d]{24}\/scan$/, strict({})],
];
