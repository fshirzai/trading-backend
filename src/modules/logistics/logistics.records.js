import { Shipment } from "./logistics.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountLogisticsRecords(app) {
  readRecords(app, "shipment", Shipment, [
    "admin",
    "manager",
    "seller",
    "procurement",
  ]);
}
