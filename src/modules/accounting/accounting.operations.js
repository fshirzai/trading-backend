import mongoose from "mongoose";
import * as M from "../../models.js";
import {
  requireRule,
  cents,
  refundQuote,
  canDispatch,
  deliveryBalance,
  balanced,
  RuleError,
  quantitySum,
} from "../../shared/rules.js";
import {
  wrap,
  tx,
  audit,
  line,
  post,
  roles,
  manage,
  sales,
  procure,
  positive,
  id,
  entity,
  ownOrder,
  list,
} from "../../shared/services.js";
export function mountAccountingOperations(app, config) {
  app.post(
    "/api/journals",
    manage,
    wrap(async (req, res) => {
      requireRule(
        typeof req.body.memo === "string" && req.body.memo.trim(),
        "Memo required",
      );
      balanced(req.body.lines);
      res.status(201).json(
        await tx(async (s) => {
          const [j] = await post(
            req,
            s,
            req.body.memo,
            "manual:" + new mongoose.Types.ObjectId(),
            req.body.lines,
          );
          await audit(req, s, "journal.post", "Journal", j.id);
          return j;
        }),
      );
    }),
  );

  app.post(
    "/api/journals/:id/reverse",
    manage,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const j = await entity(M.Journal, req.params.id, s);
          requireRule(
            j.reference.startsWith("manual:"),
            "Reverse operational entries through their original workflow",
          );
          const lines = j.lines.map((l) =>
            line(l.account, l.creditCents, l.debitCents),
          );
          const [r] = await post(
            req,
            s,
            "Reversal " + j.memo,
            "reversal:" + j.id,
            lines,
            undefined,
            { reversalOf: j.id },
          );
          await audit(req, s, "journal.reverse", "Journal", j.id);
          return r;
        }),
      );
    }),
  );

  app.get(
    "/api/reports/trial-balance",
    manage,
    wrap(async (req, res) => {
      res.json(
        await M.Journal.aggregate([
          { $unwind: "$lines" },
          {
            $group: {
              _id: "$lines.account",
              debitCents: { $sum: "$lines.debitCents" },
              creditCents: { $sum: "$lines.creditCents" },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      );
    }),
  );
}
