import { FiscalClose, AccountingPeriod, Journal } from "./accounting.model.js";
import { accountChart } from "./extensions.routes.js";
import { wrap, tx, manage, post, line, audit } from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
export function mountFiscalClose(app) {
  app.post(
    "/api/accounting/fiscal-close",
    manage,
    wrap(async (req, res) => {
      const year = req.body.year;
      requireRule(
        year < new Date().getUTCFullYear(),
        "Only completed fiscal years can close",
      );
      res.status(201).json(
        await tx(async (s) => {
          const count = await AccountingPeriod.countDocuments({
            month: {
              $in: Array.from(
                { length: 12 },
                (_, i) => year + "-" + String(i + 1).padStart(2, "0"),
              ),
            },
            closedAt: { $ne: null },
          }).session(s);
          requireRule(count === 12, "Close all 12 accounting months first");
          requireRule(
            !(await FiscalClose.exists({ year }).session(s)),
            "Fiscal year already closed",
          );
          const rows = await Journal.find({
            createdAt: {
              $gte: new Date(year + "-01-01T00:00:00Z"),
              $lte: new Date(year + "-12-31T23:59:59.999Z"),
            },
            closing: { $ne: true },
          })
            .select("lines")
            .session(s);
          const chart = await accountChart(),
            balances = new Map();
          for (const j of rows)
            for (const l of j.lines)
              if (
                chart.some(
                  (a) =>
                    a.name === l.account &&
                    ["income", "expense"].includes(a.type),
                )
              )
                balances.set(
                  l.account,
                  (balances.get(l.account) || 0) + l.creditCents - l.debitCents,
                );
          const profit = [...balances.values()].reduce((v, x) => v + x, 0),
            lines = [];
          for (const [name, net] of balances)
            if (net)
              lines.push(net > 0 ? line(name, net) : line(name, 0, -net));
          if (profit)
            lines.push(
              profit > 0
                ? line("Retained earnings", 0, profit)
                : line("Retained earnings", -profit),
            );
          const [close] = await FiscalClose.create(
            [
              {
                year,
                profitCents: profit,
                closedBy: req.user.id,
                closedAt: new Date(),
              },
            ],
            { session: s },
          );
          if (lines.length)
            await post(
              req,
              s,
              "Fiscal close " + year,
              "fiscal-close:" + year,
              lines,
              undefined,
              {
                closing: true,
                createdAt: new Date(year + "-12-31T23:59:59.999Z"),
              },
            );
          await audit(req, s, "fiscal.close", "FiscalClose", close.id);
          return close;
        }),
      );
    }),
  );
}
