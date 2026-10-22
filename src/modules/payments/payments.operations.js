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
export function mountPaymentsOperations(app, config) {
  app.post(
    "/api/orders/:id/payments",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const o = await ownOrder(req, req.params.id);
      requireRule(
        o.acceptedAt && !["Refunded", "Return requested"].includes(o.status),
        "Order not payable",
      );
      requireRule(req.body.method === "TT", "Visa gateway not configured");
      const amountCents = cents(req.body.amount);
      requireRule(
        amountCents <= o.totalCents - o.paidCents,
        "Payment exceeds balance",
      );
      requireRule(
        typeof req.body.reference === "string" && req.body.reference.trim(),
        "Transfer reference required",
      );
      const out = await tx(async (s) => {
        const fresh = await ownOrder(req, o.id, s);
        requireRule(
          req.user.role !== "customer" || !!req.body.receiptKey,
          "Upload a TT receipt before submitting payment",
        );
        if (req.body.receiptKey) {
          const doc = await entity(M.Document, req.body.receiptKey, s);
          requireRule(
            String(doc.order) === o.id &&
              doc.kind === "payment-receipt" &&
              doc.status === "Clean",
            "A clean payment receipt for this order is required",
          );
        }
        requireRule(
          fresh.acceptedAt &&
            !["Refunded", "Return requested"].includes(fresh.status),
          "Order not payable",
        );
        requireRule(
          amountCents <= fresh.totalCents - fresh.paidCents,
          "Payment exceeds balance",
        );
        const [p] = await M.Payment.create(
          [
            {
              order: o.id,
              amountCents,
              method: "TT",
              reference: req.body.reference,
              receiptKey: req.body.receiptKey,
            },
          ],
          { session: s },
        );
        await audit(req, s, "payment.submit", "Payment", p.id);
        return p;
      });
      res.status(201).json(out);
    }),
  );

  app.post(
    "/api/payments/:id/verify",
    manage,
    wrap(async (req, res) => {
      requireRule(
        req.body.bankFundsConfirmed === true,
        "Confirm actual received bank funds",
      );
      res.json(
        await tx(async (s) => {
          const p = await entity(M.Payment, req.params.id, s);
          requireRule(p.status === "Pending", "Payment already processed");
          const o = await entity(M.Order, p.order, s);
          requireRule(
            !["Refunded", "Return requested"].includes(o.status),
            "Order not payable",
          );
          requireRule(
            o.paidCents + p.amountCents <= o.totalCents,
            "Payment exceeds balance",
          );
          const ar = Math.min(o.receivableCents, p.amountCents),
            deposit = p.amountCents - ar;
          await post(
            req,
            s,
            "Verified TT " + p.reference,
            "payment:" + p.id,
            [
              line("Bank", p.amountCents),
              line("Accounts receivable", 0, ar),
              line("Customer deposits", 0, deposit),
            ],
            o.id,
          );
          o.receivableCents -= ar;
          o.depositCents += deposit;
          o.paidCents += p.amountCents;
          if (
            o.status === "Deposit pending" &&
            o.paidCents >= Math.ceil(o.productCents / 2)
          )
            o.status = "Ready to ship";
          p.status = "Verified";
          p.verifiedBy = req.user.id;
          p.verifiedAt = new Date();
          await p.save({ session: s });
          await o.save({ session: s });
          await audit(req, s, "payment.verify", "Payment", p.id, {
            from: "Pending",
            to: "Verified",
            amountCents: p.amountCents,
            reference: p.reference,
          });
          return p;
        }),
      );
    }),
  );
}
