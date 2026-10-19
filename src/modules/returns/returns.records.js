import { Return } from "./returns.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountReturnsRecords(app) {
  readRecords(app, "return", Return, ["admin", "manager", "seller"]);
}
