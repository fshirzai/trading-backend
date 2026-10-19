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
export function mountPayrollOperations(app, config) {
  app.post(
    "/api/employees/:id/advance",
    manage,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const e = await entity(M.Employee, req.params.id, s),
            amount = cents(req.body.amount);
          requireRule(e.active, "Inactive employee");
          e.advanceCents += amount;
          await e.save({ session: s });
          await post(
            req,
            s,
            "Advance " + e.name,
            "advance:" + new mongoose.Types.ObjectId(),
            [line("Employee advances", amount), line("Bank", 0, amount)],
          );
          await audit(req, s, "salary.advance", "Employee", e.id, { amount });
          return e;
        }),
      );
    }),
  );

  app.post(
    "/api/employees/:id/salary",
    manage,
    wrap(async (req, res) => {
      requireRule(
        /^\d{4}-(0[1-9]|1[0-2])$/.test(req.body.month),
        "Valid salary month required",
      );
      res.status(201).json(
        await tx(async (s) => {
          const e = await entity(M.Employee, req.params.id, s),
            deduction = req.body.deduction ? cents(req.body.deduction) : 0;
          requireRule(
            e.active &&
              deduction <= e.advanceCents &&
              deduction <= e.salaryCents,
            "Invalid advance deduction",
          );
          const [salary] = await M.Salary.create(
            [
              {
                employee: e.id,
                month: req.body.month,
                grossCents: e.salaryCents,
                deductionCents: deduction,
                netCents: e.salaryCents - deduction,
              },
            ],
            { session: s },
          );
          await post(
            req,
            s,
            "Salary " + e.name + " " + salary.month,
            "salary:" + salary.id,
            [
              line("Salary expense", e.salaryCents),
              line("Bank", 0, salary.netCents),
              line("Employee advances", 0, deduction),
            ],
          );
          e.advanceCents -= deduction;
          await e.save({ session: s });
          await audit(req, s, "salary.pay", "Salary", salary.id);
          return salary;
        }),
      );
    }),
  );
}
