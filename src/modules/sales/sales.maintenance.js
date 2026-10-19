import * as M from "../../models.js";
import {
  wrap,
  tx,
  manage,
  sales,
  procure,
  roles,
  entity,
  ownOrder,
  audit,
} from "../../shared/services.js";
import { cents, requireRule } from "../../shared/rules.js";
export function mountSalesMaintenance(app, config) {
  app.post(
    "/api/orders/:id/revise",
    sales,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s);
          requireRule(
            o.paidCents === 0 &&
              !(await M.Payment.exists({ order: o.id }).session(s)) &&
              !(await M.Shipment.exists({ order: o.id }).session(s)),
            "Cannot revise after a payment submission or dispatch",
          );
          requireRule(
            !["Refunded", "Return requested"].includes(o.status),
            "Order closed",
          );
          o.proformaHistory.push({
            version: o.version,
            productSnapshot: o.productSnapshot,
            productCents: o.productCents,
            feesCents: o.feesCents,
            totalCents: o.totalCents,
            border: o.border,
            splitIncluded: o.splitIncluded,
            acceptedSnapshot: o.acceptedSnapshot,
            revisedBy: req.user.id,
            revisedAt: new Date(),
            reason: req.body.reason,
          });
          o.version++;
          o.productCents = cents(req.body.productTotal);
          o.feesCents = req.body.deliveryFees
            ? cents(req.body.deliveryFees)
            : 0;
          o.totalCents = o.productCents + o.feesCents;
          o.border = req.body.border;
          o.splitIncluded = req.body.splitIncluded;
          o.acceptedAt = undefined;
          o.acceptedSnapshot = undefined;
          o.status = "Awaiting acceptance";
          await o.save({ session: s });
          await audit(req, s, "proforma.revise", "Order", o.id, {
            version: o.version,
            reason: req.body.reason,
          });
          return o;
        }),
      );
    }),
  );

  app.get(
    "/api/orders/:id/proforma",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const o = await ownOrder(req, req.params.id);
      const customer = await entity(M.Party, o.customer);
      res.json({
        orderId: o.id,
        version: o.version,
        currency: "USD",
        customer: {
          name: customer.name,
          country: customer.country,
          address: customer.address,
        },
        product: o.productSnapshot,
        quantityTonnes: o.quantity,
        productCents: o.productCents,
        deliveryFeesCents: o.feesCents,
        totalCents: o.totalCents,
        border: o.border,
        splitIncluded: o.splitIncluded,
        acceptedAt: o.acceptedAt,
        acceptedTerms: o.acceptedSnapshot,
        returnWindowHours: o.returnHours,
        cancellation: {
          beforeDispatch: "Full refund of verified amount paid",
          afterDispatch:
            "Retain 25% of order total; refund verified paid funds minus charge; return transport included",
        },
      });
    }),
  );
}
