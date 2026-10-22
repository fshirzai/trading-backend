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
import {
  releaseReservations,
  orderItems,
  itemId,
} from "../inventory/reservations.service.js";
export function mountReturnsOperations(app, config) {
  app.post(
    "/api/orders/:id/returns",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      res.status(201).json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s);
          requireRule(
            o.acceptedAt &&
              !["Return requested", "Refunded"].includes(o.status),
            "Order not eligible",
          );
          const shipments = await M.Shipment.find({ order: o.id }).session(s);
          const quote = refundQuote({
            totalCents: o.totalCents,
            paidCents: o.paidCents,
            hasShipped: shipments.length > 0,
            handedOverAt: shipments
              .filter((x) => x.handedOverAt)
              .sort((a, b) => a.handedOverAt - b.handedOverAt)[0]?.handedOverAt,
            returnHours: o.returnHours,
          });
          const [r] = await M.Return.create(
            [
              {
                order: o.id,
                reason: req.body.reason,
                previousStatus: o.status,
                ...quote,
                hasShipped: shipments.length > 0,
                requestedAt: new Date(),
              },
            ],
            { session: s },
          );
          o.status = "Return requested";
          await o.save({ session: s });
          await audit(req, s, "return.request", "Return", r.id);
          return r;
        }),
      );
    }),
  );

  app.post(
    "/api/returns/:id/complete",
    manage,
    wrap(async (req, res) => {
      requireRule(
        req.body.inspectionPassed === true && req.body.refundConfirmed === true,
        "Confirm returned condition and actual refund transfer",
      );
      res.json(
        await tx(async (s) => {
          const r = await entity(M.Return, req.params.id, s);
          requireRule(r.status === "Requested", "Return already processed");
          requireRule(
            !(await M.CardRefund.exists({
              return: r.id,
              status: "Pending",
            }).session(s)),
            "Card refund still pending at provider",
          );
          const o = await entity(M.Order, r.order, s),
            shipments = await M.Shipment.find({ order: o.id }).session(s);
          const shipped = quantitySum(shipments.map((x) => x.quantity));
          requireRule(
            !r.hasShipped || req.body.returnedQuantity === shipped,
            "All dispatched goods must be returned for full-order cancellation",
          );
          if (r.hasShipped) {
            const wh = await entity(M.Warehouse, req.body.warehouse, s);
            requireRule(wh.active, "Warehouse inactive");
            let returnCost = 0;
            for (const sh of shipments) {
              returnCost += sh.costCents;
              const [returnedBatch] = await M.Batch.create(
                [
                  {
                    product: sh.product || o.product,
                    returnId: r.id,
                    warehouse: req.body.warehouse,
                    code: "RET-" + sh.id,
                    quantity: sh.quantity,
                    unitCostCents: sh.costCents / sh.quantity,
                    valueCents: sh.costCents,
                    condition: "Good",
                  },
                ],
                { session: s },
              );
              r.receivedBatches.push(returnedBatch.id);
              await M.Movement.create(
                [
                  {
                    batch: returnedBatch.id,
                    actor: req.user.id,
                    quantity: sh.quantity,
                    kind: "Return",
                    order: o.id,
                    reference: r.id,
                  },
                ],
                { session: s },
              );
            }
            if (returnCost)
              await post(
                req,
                s,
                "Returned goods",
                "return-stock:" + r.id,
                [
                  line("Inventory", returnCost),
                  line("Cost of goods sold", 0, returnCost),
                ],
                o.id,
              );
          }
          await releaseReservations(o.id, s);
          await M.ProcurementRequest.updateMany(
            { order: o.id, status: { $in: ["Requested", "Purchasing"] } },
            { $set: { status: "Cancelled" } },
            { session: s },
          );
          r.warehouse = req.body.warehouse;
          r.completedBy = req.user.id;
          r.refundReference = req.body.refundReference;
          const recognized =
            o.revenueCents +
            (shipments.some((x) => x.status === "Handed over") &&
            orderItems(o).every(
              (i) =>
                quantitySum(
                  shipments
                    .filter(
                      (x) =>
                        x.status === "Handed over" &&
                        (x.item || "legacy") === itemId(i),
                    )
                    .map((x) => x.quantity),
                ) >= i.quantity,
            )
              ? o.feesCents
              : 0);
          if (recognized)
            await post(
              req,
              s,
              "Reverse cancelled sale",
              "return-sale:" + r.id,
              [
                line("Sales revenue", recognized),
                line("Accounts receivable", 0, o.receivableCents),
                line("Customer deposits", 0, recognized - o.receivableCents),
              ],
              o.id,
            );
          if (o.paidCents)
            await post(
              req,
              s,
              "Cancellation settlement",
              "return-refund:" + r.id,
              [
                line("Customer deposits", o.paidCents),
                line("Bank", 0, r.refundCents),
                line("Cancellation income", 0, r.retainedCents),
              ],
              o.id,
            );
          o.depositCents = 0;
          o.receivableCents = 0;
          o.revenueCents = 0;
          o.refundedCents = r.refundCents;
          o.status = "Refunded";
          await o.save({ session: s });
          r.status = "Refunded";
          r.inspection = {
            checkedBy: req.user.id,
            quantity: req.body.returnedQuantity,
            note: req.body.note,
            condition: "Delivered condition",
            returnTransport: "Covered by 25% retained charge",
          };
          r.refundedAt = new Date();
          await r.save({ session: s });
          await audit(req, s, "return.complete", "Return", r.id, {
            warehouse: r.warehouse,
            refundCents: r.refundCents,
            retainedCents: r.retainedCents,
            refundReference: r.refundReference,
            inspectionPassed: true,
          });
          return r;
        }),
      );
    }),
  );
}
