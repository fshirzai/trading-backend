import { BankStatement, BankLine } from "./reconciliation.model.js";
import { Journal } from "../accounting/accounting.model.js";
import { parseStatement } from "./reconciliation.service.js";
import { digest } from "../../shared/encryption.js";
import {
  wrap,
  tx,
  manage,
  entity,
  audit,
  list,
} from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
export function mountReconciliation(app) {
  app.post(
    "/api/reconciliation/statements",
    manage,
    wrap(async (req, res) => {
      const rows = parseStatement(req.body.csv);
      requireRule(
        req.body.openingCents + rows.reduce((v, r) => v + r.amountCents, 0) ===
          req.body.closingCents,
        "Closing balance does not match statement movements",
      );
      res.status(201).json(
        await tx(async (s) => {
          const [statement] = await BankStatement.create(
            [
              {
                name: req.body.name,
                account: req.body.account,
                sha256: digest(req.body.account + "|" + req.body.csv),
                openingCents: req.body.openingCents,
                closingCents: req.body.closingCents,
              },
            ],
            { session: s },
          );
          await BankLine.insertMany(
            rows.map((r) => ({ ...r, statement: statement.id })),
            { session: s, ordered: true },
          );
          await audit(
            req,
            s,
            "statement.import",
            "BankStatement",
            statement.id,
          );
          return statement;
        }),
      );
    }),
  );
  app.get(
    "/api/reconciliation/statements",
    manage,
    wrap(async (req, res) =>
      res.json(await list(BankStatement, {}, req.query)),
    ),
  );
  app.get(
    "/api/reconciliation/statements/:id",
    manage,
    wrap(async (req, res) => {
      const statement = await entity(BankStatement, req.params.id);
      res.json({
        statement,
        ...(await list(BankLine, { statement: statement.id }, req.query)),
      });
    }),
  );
  app.post(
    "/api/reconciliation/lines/:id/match",
    manage,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const line = await entity(BankLine, req.params.id, s),
            statement = await entity(BankStatement, line.statement, s);
          requireRule(
            statement.status === "Open" && !line.journal,
            "Statement closed or line matched",
          );
          const journal = await entity(Journal, req.body.journal, s);
          const amount = journal.lines
            .filter((l) => l.account === statement.account)
            .reduce((v, l) => v + l.debitCents - l.creditCents, 0);
          requireRule(
            amount === line.amountCents,
            "Journal cash movement differs from bank line",
          );
          line.journal = journal.id;
          line.matchedBy = req.user.id;
          await line.save({ session: s });
          await audit(req, s, "statement.match", "BankLine", line.id);
          return line;
        }),
      );
    }),
  );
  app.post(
    "/api/reconciliation/statements/:id/close",
    manage,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const statement = await entity(BankStatement, req.params.id, s);
          requireRule(statement.status === "Open", "Statement already closed");
          requireRule(
            !(await BankLine.exists({
              statement: statement.id,
              journal: null,
            }).session(s)),
            "Match every statement line before closing",
          );
          const lines = await BankLine.find({
            statement: statement.id,
          }).session(s);
          const cutoff = new Date(
            Math.max(...lines.map((x) => x.date.getTime())) + 86399999,
          );
          const journals = await Journal.find({ createdAt: { $lte: cutoff } })
            .select("lines")
            .session(s);
          const balance = journals.reduce(
            (v, j) =>
              v +
              j.lines
                .filter((l) => l.account === statement.account)
                .reduce((a, l) => a + l.debitCents - l.creditCents, 0),
            0,
          );
          requireRule(
            balance === statement.closingCents,
            "Ledger balance differs from statement closing balance",
          );
          statement.status = "Closed";
          statement.closedAt = new Date();
          statement.closedBy = req.user.id;
          await statement.save({ session: s });
          await audit(req, s, "statement.close", "BankStatement", statement.id);
          return statement;
        }),
      );
    }),
  );
}
