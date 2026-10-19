import { Account, Expense, Journal } from "./accounting.model.js";
import { chart } from "./chart.service.js";
import {
  wrap,
  tx,
  manage,
  post,
  line,
  audit,
  ownOrder,
  list,
} from "../../shared/services.js";
import { cents, requireRule } from "../../shared/rules.js";
export async function accountChart() {
  const custom = await Account.find({ active: true }).lean();
  return [
    ...chart,
    ...custom
      .filter((x) => !chart.some((a) => a.name === x.name))
      .map((x) => ({ code: x.code, name: x.name, type: x.type })),
  ];
}
export function mountAccountingExtensions(app) {
  app.post(
    "/api/accounting/accounts",
    manage,
    wrap(async (req, res) => {
      requireRule(
        !chart.some(
          (x) => x.code === req.body.code || x.name === req.body.name,
        ),
        "Built-in account already exists",
      );
      res.status(201).json(
        await tx(async (s) => {
          const [a] = await Account.create([req.body], { session: s });
          await audit(req, s, "account.create", "Account", a.id);
          return a;
        }),
      );
    }),
  );
  app.post(
    "/api/accounting/expenses",
    manage,
    wrap(async (req, res) =>
      res.status(201).json(
        await tx(async (s) => {
          if (req.body.order) await ownOrder(req, req.body.order, s);
          const amount = cents(req.body.amount),
            account = await accountChart();
          requireRule(
            account.some(
              (a) => a.name === req.body.category && a.type === "expense",
            ),
            "Expense account required",
          );
          const [e] = await Expense.create(
            [
              {
                category: req.body.category,
                amountCents: amount,
                memo: req.body.memo,
                order: req.body.order,
                reference: req.body.reference,
              },
            ],
            { session: s },
          );
          await post(
            req,
            s,
            e.memo,
            "expense:" + e.id,
            [line(e.category, amount), line("Bank", 0, amount)],
            e.order,
          );
          await audit(req, s, "expense.post", "Expense", e.id);
          return e;
        }),
      ),
    ),
  );
  app.get(
    "/api/accounting/expenses",
    manage,
    wrap(async (req, res) => res.json(await list(Expense, {}, req.query))),
  );
  app.get(
    "/api/reports/orders/:id/profit",
    manage,
    wrap(async (req, res) => {
      const o = await ownOrder(req, req.params.id);
      const rows = await Journal.find({ order: o.id })
        .select("lines")
        .lean()
        .maxTimeMS(5000);
      const accounts = await accountChart();
      let revenueCents = 0,
        costCents = 0;
      for (const j of rows)
        for (const l of j.lines) {
          const type = accounts.find((a) => a.name === l.account)?.type;
          if (type === "income") revenueCents += l.creditCents - l.debitCents;
          if (type === "expense") costCents += l.debitCents - l.creditCents;
        }
      res.json({
        order: o.id,
        currency: "USD",
        revenueCents,
        costCents,
        profitCents: revenueCents - costCents,
      });
    }),
  );
}
