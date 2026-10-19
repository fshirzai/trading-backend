import { Employee } from "./payroll.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountPayrollRecords(app) {
  readRecords(app, "employee", Employee, ["admin", "manager"]);
  createRecord(
    app,
    "employee",
    Employee,
    ["admin", "manager"],
    ["name", "job"],
  );
  patchRecord(app, "employee", Employee, ["admin", "manager"]);
}
