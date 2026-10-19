import { Audit } from "./audit.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountAuditRecords(app) {
  readRecords(app, "audit", Audit, ["admin", "manager"]);
}
