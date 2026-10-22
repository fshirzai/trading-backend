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
import { reserveOrder } from "../inventory/reservations.service.js";
export function mountProcurementOperations(app, config) {
  app.post(
    "/api/purchases",
    procure,
    wrap(async (req, res) => {
      const out = await tx(async (s) => {
        const supplier = await entity(M.Party, req.body.supplier, s);
        requireRule(supplier.type === "supplier", "Supplier required");
        await entity(M.Product, req.body.product, s);
        let demand;
        if (req.body.request) {
          demand = await entity(M.ProcurementRequest, req.body.request, s);
          const demandOrder = await entity(M.Order, demand.order, s);
          requireRule(
            demandOrder.acceptedAt &&
              !["Return requested", "Refunded", "Delivered"].includes(
                demandOrder.status,
              ),
            "Procurement order is closed or returning",
          );
          requireRule(
            ["Requested", "Purchasing"].includes(demand.status) &&
              String(demand.product) === req.body.product,
            "Request/product mismatch or request closed",
          );
          const committed = await M.Purchase.find({
            request: demand.id,
          }).session(s);
          requireRule(
            quantitySum([
              ...committed.map((p) => p.quantity),
              req.body.quantity,
            ]) <= demand.quantity,
            "Purchase exceeds requested shortage",
          );
          demand.status = "Purchasing";
          await demand.save({ session: s });
        }
        const [p] = await M.Purchase.create(
          [
            {
              request: demand?.id,
              order: demand?.order,
              supplier: supplier.id,
              product: req.body.product,
              quantity: positive(req.body.quantity),
              costCents: cents(req.body.totalCost),
            },
          ],
          { session: s },
        );
        await audit(req, s, "purchase.create", "Purchase", p.id);
        return p;
      });
      res.status(201).json(out);
    }),
  );

  app.post(
    "/api/purchases/:id/receive",
    procure,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const p = await entity(M.Purchase, req.params.id, s);
          requireRule(p.status === "Ordered", "Purchase already received");
          const wh = await entity(M.Warehouse, req.body.warehouse, s);
          requireRule(wh.active, "Warehouse inactive");
          requireRule(req.body.batchCode, "Batch code required");
          const [b] = await M.Batch.create(
            [
              {
                product: p.product,
                purchase: p.id,
                location: req.body.location,
                warehouse: req.body.warehouse,
                code: req.body.batchCode,
                quantity: p.quantity,
                unitCostCents: p.costCents / p.quantity,
                valueCents: p.costCents,
              },
            ],
            { session: s },
          );
          await M.Movement.create(
            [
              {
                batch: b.id,
                quantity: p.quantity,
                kind: "Receipt",
                reference: p.id,
              },
            ],
            { session: s },
          );
          await post(req, s, "Goods received", "purchase:" + p.id, [
            line("Inventory", p.costCents),
            line("Accounts payable", 0, p.costCents),
          ]);
          p.receivedBatch = b.id;
          if (p.request) {
            const demand = await entity(M.ProcurementRequest, p.request, s);
            demand.receivedQuantity = quantitySum([
              demand.receivedQuantity,
              p.quantity,
            ]);
            if (
              demand.status !== "Cancelled" &&
              demand.receivedQuantity >= demand.quantity
            )
              demand.status = "Received";
            await demand.save({ session: s });
            const o = await entity(M.Order, demand.order, s);
            if (
              o.acceptedAt &&
              !["Return requested", "Refunded"].includes(o.status)
            ) {
              await reserveOrder(o, s);
              await o.save({ session: s });
            }
          }
          p.status = "Received";
          p.receivedAt = new Date();
          await p.save({ session: s });
          await audit(req, s, "purchase.receive", "Purchase", p.id);
          return b;
        }),
      );
    }),
  );
}
