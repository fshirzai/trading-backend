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
export function mountLogisticsOperations(app, config) {
  app.post(
    "/api/orders/:id/shipments",
    sales,
    wrap(async (req, res) => {
      res.status(201).json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s),
            prior = await M.Shipment.find({ order: o.id }).session(s),
            q = positive(req.body.quantity);
          canDispatch(o, q, quantitySum(prior.map((x) => x.quantity)));
          const feeCents = req.body.additionalFee
            ? cents(req.body.additionalFee)
            : 0;
          requireRule(
            !feeCents ||
              (req.body.feeAccepted === true && req.body.acceptanceEvidence),
            "Customer acceptance of delivery charge required",
          );
          requireRule(
            prior.length === 0 || feeCents > 0 || o.splitIncluded === true,
            "Additional delivery fee or original agreed inclusion required",
          );
          const allocations = [];
          let costCents = 0;
          if (req.body.direct === true) {
            requireRule(
              typeof req.body.sourceBorder === "string" &&
                req.body.sourceBorder.trim(),
              "Origin border required",
            );
            requireRule(
              req.body.directCost !== undefined,
              "Direct trade purchase cost required",
            );
            costCents = cents(req.body.directCost);
            await post(
              req,
              s,
              "Direct trade cost",
              "direct:" + o.id + ":" + prior.length,
              [
                line("Cost of goods sold", costCents),
                line("Accounts payable", 0, costCents),
              ],
              o.id,
            );
          } else {
            const wh = await entity(M.Warehouse, req.body.warehouse, s);
            requireRule(wh.active, "Warehouse inactive");
            const batches = await M.Batch.find({
              product: o.product,
              warehouse: req.body.warehouse,
              quantity: { $gt: 0 },
              condition: "Good",
            })
              .sort({ createdAt: 1 })
              .session(s);
            requireRule(
              quantitySum(batches.map((b) => b.quantity)) >= q,
              "Insufficient warehouse stock",
            );
            let rem = q;
            for (const b of batches) {
              if (rem <= 0) break;
              const used = Math.min(b.quantity, rem);
              const usedCost =
                used === b.quantity
                  ? b.valueCents
                  : Math.round((b.valueCents * used) / b.quantity);
              b.quantity = quantitySum([b.quantity, -used]);
              b.valueCents -= usedCost;
              rem = quantitySum([rem, -used]);
              await b.save({ session: s });
              allocations.push({
                batch: b.id,
                quantity: used,
                unitCostCents: b.unitCostCents,
                valueCents: usedCost,
              });
              costCents += usedCost;
              await M.Movement.create(
                [
                  {
                    batch: b.id,
                    quantity: -used,
                    kind: "Dispatch",
                    order: o.id,
                  },
                ],
                { session: s },
              );
            }
            await post(
              req,
              s,
              "Dispatch cost",
              "dispatch:" + o.id + ":" + prior.length,
              [
                line("Cost of goods sold", costCents),
                line("Inventory", 0, costCents),
              ],
              o.id,
            );
          }
          requireRule(
            Number.isSafeInteger(o.totalCents + feeCents),
            "Order total too large",
          );
          o.feesCents += feeCents;
          o.totalCents += feeCents;
          o.status = "In transit";
          await o.save({ session: s });
          const [shipment] = await M.Shipment.create(
            [
              {
                order: o.id,
                quantity: q,
                direct: req.body.direct === true,
                sourceBorder: req.body.sourceBorder,
                warehouse: req.body.direct ? undefined : req.body.warehouse,
                border: o.border,
                driver: req.body.driver,
                phone: req.body.phone,
                vehicle: req.body.vehicle,
                feeCents,
                feeAcceptedAt: feeCents ? new Date() : undefined,
                acceptanceEvidence: req.body.acceptanceEvidence,
                splitIncluded: o.splitIncluded,
                costCents,
                allocations,
              },
            ],
            { session: s },
          );
          await audit(req, s, "shipment.dispatch", "Shipment", shipment.id, {
            quantity: q,
            feeCents,
          });
          return shipment;
        }),
      );
    }),
  );

  app.post(
    "/api/shipments/:id/handover",
    sales,
    wrap(async (req, res) => {
      requireRule(
        req.body.recipient && req.body.proof,
        "Recipient and proof reference required",
      );
      res.json(
        await tx(async (s) => {
          const sh = await entity(M.Shipment, req.params.id, s);
          requireRule(
            sh.status === "In transit",
            "Shipment already handed over",
          );
          const o = await entity(M.Order, sh.order, s);
          requireRule(
            !["Return requested", "Refunded"].includes(o.status),
            "Return in progress",
          );
          const prior = await M.Shipment.find({
              order: o.id,
              status: "Handed over",
            }).session(s),
            qty = quantitySum([...prior.map((x) => x.quantity), sh.quantity]);
          requireRule(
            o.paidCents >= deliveryBalance(o, qty),
            "Collect balance for this delivery and additional fees first",
          );
          const value =
            Math.round((o.productCents * qty) / o.quantity) - o.revenueCents;
          const final = qty >= o.quantity;
          const recognized = value + (final ? o.feesCents : 0),
            dep = Math.min(o.depositCents, recognized),
            ar = recognized - dep;
          await post(
            req,
            s,
            "Border handover",
            "handover:" + sh.id,
            [
              line("Customer deposits", dep),
              line("Accounts receivable", ar),
              line("Sales revenue", 0, recognized),
            ],
            o.id,
          );
          o.depositCents -= dep;
          o.receivableCents += ar;
          o.revenueCents += value;
          o.status = final ? "Delivered" : "Partially delivered";
          o.handedOverAt = new Date();
          sh.status = "Handed over";
          sh.recipient = req.body.recipient;
          sh.proof = req.body.proof;
          sh.handedOverAt = o.handedOverAt;
          await sh.save({ session: s });
          await o.save({ session: s });
          await audit(req, s, "shipment.handover", "Shipment", sh.id);
          return sh;
        }),
      );
    }),
  );
}
