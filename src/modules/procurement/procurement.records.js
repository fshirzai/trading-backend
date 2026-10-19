import { Purchase } from "./procurement.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountProcurementRecords(app) {
  readRecords(app, "purchase", Purchase, ["admin", "manager", "procurement"]);
}
