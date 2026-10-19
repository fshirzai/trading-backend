import { parse } from "csv-parse/sync";
import { requireRule } from "../../shared/rules.js";
export function parseStatement(csv) {
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    max_record_size: 2048,
    bom: true,
  });
  requireRule(
    rows.length > 0 && rows.length <= 10000,
    "Statement needs 1–10000 rows",
  );
  const refs = new Set();
  return rows.map((row) => {
    requireRule(
      Object.keys(row).sort().join(",") === "amount,date,reference",
      "CSV columns must be date,reference,amount",
    );
    requireRule(
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        Number.isFinite(new Date(row.date).getTime()) &&
        new Date(row.date).toISOString().slice(0, 10) === row.date,
      "Invalid statement date",
    );
    requireRule(
      row.reference.length > 0 &&
        row.reference.length <= 200 &&
        !refs.has(row.reference),
      "Unique reference required",
    );
    refs.add(row.reference);
    requireRule(
      /^-?\d{1,10}(\.\d{1,2})?$/.test(row.amount) && Number(row.amount) !== 0,
      "Signed amount with at most two decimals required",
    );
    return {
      date: new Date(row.date),
      reference: row.reference,
      amountCents: Math.round(Number(row.amount) * 100),
    };
  });
}
