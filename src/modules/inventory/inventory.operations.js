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
export function mountInventoryOperations(app, config) {
  app.post(
    "/api/stock/transfer",
    procure,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const b = await entity(M.Batch, req.body.batch, s),
            q = positive(req.body.quantity);
          requireRule(
            quantitySum([b.quantity, -(b.reservedQuantity || 0)]) >= q &&
              String(b.warehouse) !== req.body.warehouse,
            "Invalid quantity or destination",
          );
          const wh = await entity(M.Warehouse, req.body.warehouse, s);
          requireRule(wh.active, "Warehouse inactive");
          const transferredCents =
            q === b.quantity
              ? b.valueCents
              : Math.round((b.valueCents * q) / b.quantity);
          b.quantity = quantitySum([b.quantity, -q]);
          b.valueCents -= transferredCents;
          await b.save({ session: s });
          let target = await M.Batch.findOne({
            product: b.product,
            warehouse: req.body.warehouse,
            code: b.code,
          }).session(s);
          if (target) {
            requireRule(
              target.unitCostCents === b.unitCostCents &&
                target.condition === b.condition,
              "Batch unit costs differ",
            );
            target.quantity = quantitySum([target.quantity, q]);
            target.valueCents += transferredCents;
            await target.save({ session: s });
          } else
            [target] = await M.Batch.create(
              [
                {
                  product: b.product,
                  condition: b.condition,
                  warehouse: req.body.warehouse,
                  code: b.code,
                  quantity: q,
                  unitCostCents: b.unitCostCents,
                  valueCents: transferredCents,
                },
              ],
              { session: s },
            );
          await M.Movement.create(
            [
              { batch: b.id, quantity: -q, kind: "TransferOut" },
              { batch: target.id, quantity: q, kind: "TransferIn" },
            ],
            { session: s, ordered: true },
          );
          await audit(req, s, "stock.transfer", "Batch", b.id, {
            quantity: q,
            destination: target.warehouse,
          });
          return target;
        }),
      );
    }),
  );
}
