import { Payment } from "./payments.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountPaymentsRecords(app) {
  readRecords(app, "payment", Payment, ["admin", "manager", "seller"]);
}
