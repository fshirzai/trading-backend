import { Party } from "./contacts.model.js";
import {
  readRecords,
  createRecord,
  patchRecord,
} from "../../shared/records.js";
import { requireRule } from "../../shared/rules.js";
export function mountContactsRecords(app) {
  readRecords(app, "party", Party, [
    "admin",
    "manager",
    "seller",
    "procurement",
  ]);
  createRecord(
    app,
    "party",
    Party,
    ["admin", "manager", "seller", "procurement"],
    ["name", "type", "country", "email", "phone", "address"],
    (req) => {
      requireRule(
        req.user.role !== "seller" || req.body.type === "customer",
        "Seller creates customers only",
      );
      requireRule(
        req.user.role !== "procurement" || req.body.type === "supplier",
        "Procurement creates suppliers only",
      );
    },
  );
}
