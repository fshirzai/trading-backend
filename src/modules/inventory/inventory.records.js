import { Warehouse, Batch } from "./inventory.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountInventoryRecords(app) {
  readRecords(app, "warehouse", Warehouse, [
    "admin",
    "manager",
    "seller",
    "procurement",
  ]);
  createRecord(
    app,
    "warehouse",
    Warehouse,
    ["admin", "manager"],
    ["name", "country", "address"],
  );
  patchRecord(app, "warehouse", Warehouse, ["admin", "manager"]);
  readRecords(app, "batch", Batch, [
    "admin",
    "manager",
    "seller",
    "procurement",
  ]);
}
