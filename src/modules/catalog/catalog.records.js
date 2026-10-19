import { Product } from "./catalog.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountCatalogRecords(app) {
  readRecords(app, "product", Product, [
    "admin",
    "manager",
    "seller",
    "procurement",
    "customer",
  ]);
  createRecord(
    app,
    "product",
    Product,
    ["admin", "manager", "procurement"],
    ["name", "category", "grade", "origin", "packaging", "moq"],
  );
  patchRecord(app, "product", Product, ["admin", "manager", "procurement"]);
}
