import { accountChart } from "./extensions.routes.js";
import {
  Journal,
  Purchase,
  SupplierPayment,
  AccountingPeriod,
} from "../../models.js";
import {
  wrap,
  tx,
  manage,
  entity,
  post,
  line,
  audit,
} from "../../shared/services.js";
import { cents, requireRule } from "../../shared/rules.js";
function range(q) {
  const r = {};
  if (q.from) r.$gte = new Date(q.from + "T00:00:00.000Z");
  if (q.to) r.$lte = new Date(q.to + "T23:59:59.999Z");
  requireRule(!q.from || !q.to || q.from <= q.to, "Invalid report date range");
  return Object.keys(r).length ? { createdAt: r } : {};
}
async function totals(q, excludeClosing = false) {
  return Journal.aggregate([
    {
      $match: {
        ...range(q),
        ...(excludeClosing ? { closing: { $ne: true } } : {}),
      },
    },
    { $unwind: "$lines" },
    {
      $group: {
        _id: "$lines.account",
        debitCents: { $sum: "$lines.debitCents" },
        creditCents: { $sum: "$lines.creditCents" },
      },
    },
  ]).option({ maxTimeMS: 5000 });
}
export function mountAccounting(app) {
  app.get(
    "/api/accounting/accounts",
    manage,
    wrap(async (req, res) => res.json({ items: await accountChart() })),
  );
  app.get(
    "/api/reports/income-statement",
    manage,
    wrap(async (req, res) => {
      const chart = await accountChart();
      const values = new Map(
        (await totals(req.query, true)).map((x) => [x._id, x]),
      );
      const rows = chart
        .filter((x) => ["income", "expense"].includes(x.type))
        .map((a) => {
          const x = values.get(a.name) || { debitCents: 0, creditCents: 0 };
          return {
            ...a,
            amountCents:
              a.type === "income"
                ? x.creditCents - x.debitCents
                : x.debitCents - x.creditCents,
          };
        });
      const incomeCents = rows
          .filter((x) => x.type === "income")
          .reduce((v, x) => v + x.amountCents, 0),
        expenseCents = rows
          .filter((x) => x.type === "expense")
          .reduce((v, x) => v + x.amountCents, 0);
      res.json({
        currency: "USD",
        rows,
        incomeCents,
        expenseCents,
        netProfitCents: incomeCents - expenseCents,
      });
    }),
  );
  app.get(
    "/api/reports/balance-sheet",
    manage,
    wrap(async (req, res) => {
      requireRule(
        !req.query.from,
        "Balance sheet must include opening balances; use only to",
      );
      const chart = await accountChart();
      const all = await totals(req.query),
        values = new Map(all.map((x) => [x._id, x]));
      const rows = chart
        .filter((x) => ["asset", "liability", "equity"].includes(x.type))
        .map((a) => {
          const x = values.get(a.name) || { debitCents: 0, creditCents: 0 };
          return {
            ...a,
            amountCents:
              a.type === "asset"
                ? x.debitCents - x.creditCents
                : x.creditCents - x.debitCents,
          };
        });
      const assetCents = rows
          .filter((x) => x.type === "asset")
          .reduce((v, x) => v + x.amountCents, 0),
        liabilityCents = rows
          .filter((x) => x.type === "liability")
          .reduce((v, x) => v + x.amountCents, 0),
        equityCents = rows
          .filter((x) => x.type === "equity")
          .reduce((v, x) => v + x.amountCents, 0),
        currentEarningsCents = chart
          .filter((x) => ["income", "expense"].includes(x.type))
          .reduce((v, a) => {
            const x = values.get(a.name);
            return v + (x ? x.creditCents - x.debitCents : 0);
          }, 0);
      res.json({
        currency: "USD",
        rows,
        assetCents,
        liabilityCents,
        equityCents,
        currentEarningsCents,
        balanced:
          assetCents === liabilityCents + equityCents + currentEarningsCents,
      });
    }),
  );
  app.get(
    "/api/reports/cash-movements",
    manage,
    wrap(async (req, res) => {
      const rows = (await totals(req.query)).filter((x) =>
        ["Bank", "Cash"].includes(x._id),
      );
      res.json({
        currency: "USD",
        rows,
        netMovementCents: rows.reduce(
          (v, x) => v + x.debitCents - x.creditCents,
          0,
        ),
      });
    }),
  );
  app.post(
    "/api/purchases/:id/pay",
    manage,
    wrap(async (req, res) => {
      res.status(201).json(
        await tx(async (s) => {
          const p = await entity(Purchase, req.params.id, s);
          requireRule(
            p.status === "Received",
            "Receive purchase before settling payable",
          );
          const amount = cents(req.body.amount);
          requireRule(
            amount <= p.costCents - p.paidCents,
            "Supplier payment exceeds payable",
          );
          const [payment] = await SupplierPayment.create(
            [
              {
                purchase: p.id,
                amountCents: amount,
                reference: req.body.reference,
              },
            ],
            { session: s },
          );
          await post(
            req,
            s,
            "Supplier settlement",
            "supplier-payment:" + payment.id,
            [line("Accounts payable", amount), line("Bank", 0, amount)],
          );
          p.paidCents += amount;
          await p.save({ session: s });
          await audit(req, s, "supplier.pay", "Purchase", p.id, { amount });
          return payment;
        }),
      );
    }),
  );
  app.post(
    "/api/accounting/periods/close",
    manage,
    wrap(async (req, res) => {
      requireRule(
        req.body.month < new Date().toISOString().slice(0, 7),
        "Only completed months can be closed",
      );
      const out = await tx(async (s) => {
        const [p] = await AccountingPeriod.create(
          [
            {
              month: req.body.month,
              closedBy: req.user.id,
              closedAt: new Date(),
            },
          ],
          { session: s },
        );
        await audit(req, s, "accounting.close", "AccountingPeriod", p.id);
        return p;
      });
      res.status(201).json(out);
    }),
  );
}
