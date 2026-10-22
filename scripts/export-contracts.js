import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { schemas } from "../src/validation.js";
const target = process.argv[2];
if (!target) throw Error("Pass frontend contracts.json path");
const old = JSON.parse(await readFile(target, "utf8"));
for (const key of [
  ...Object.keys(old),
  "POST /orders/{id}/invoices",
  "POST /orders/{id}/reserve",
  "POST /orders/{id}/procurement-requests",
  "POST /notification-delivery/{id}/retry",
]) {
  const [method, path] = key.split(" "),
    sample = "/api" + path.replaceAll("{id}", "a".repeat(24));
  const spec = schemas.find(([m, re]) => m === method && re.test(sample));
  if (spec) {
    old[key] = z.toJSONSchema(spec[2], { unrepresentable: "any" });
    delete old[key].$schema;
  }
}
await writeFile(target, JSON.stringify(old, null, 2) + "\n");
