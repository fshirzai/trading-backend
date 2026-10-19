import { Journal } from "./accounting.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountAccountingRecords(app) {
  readRecords(app, "journal", Journal, ["admin", "manager"]);
}
