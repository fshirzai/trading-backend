import express from "express";
import { CheckoutAttempt, GatewayEvent, Payment } from "./payments.model.js";
import { Order } from "../sales/sales.model.js";
import { gateway } from "./gateway.service.js";
import {
  wrap,
  tx,
  roles,
  ownOrder,
  entity,
  post,
  line,
  audit,
} from "../../shared/services.js";
import { digest } from "../../shared/encryption.js";
import { requireRule, cents, RuleError } from "../../shared/rules.js";
export function mountGatewayWebhook(app, config) {
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json", limit: "100kb" }),
    wrap(async (req, res) => {
      let event;
      try {
        event = gateway(config).verify(
          req.body,
          req.headers["stripe-signature"],
        );
      } catch (e) {
        if (e.status === 503) throw e;
        throw new RuleError("Invalid gateway signature", 400);
      }
      if (
        ![
          "checkout.session.completed",
          "checkout.session.async_payment_succeeded",
        ].includes(event.type)
      )
        return res.json({ received: true, ignored: true });
      const obj = event.data.object;
      await tx(async (s) => {
        if (await GatewayEvent.exists({ eventId: event.id }).session(s)) return;
        requireRule(
          obj.payment_status === "paid" && obj.currency === "usd",
          "Unsettled or non-USD checkout",
        );
        const attempt = await entity(CheckoutAttempt, obj.metadata?.attempt, s);
        requireRule(
          attempt.providerSession === obj.id &&
            attempt.amountCents === obj.amount_total,
          "Gateway session or amount mismatch",
        );
        const o = await entity(Order, attempt.order, s);
        requireRule(
          !["Return requested", "Refunded"].includes(o.status) &&
            o.paidCents + attempt.amountCents <= o.totalCents,
          "Order cannot accept this payment",
        );
        if (attempt.state === "Paid") return;
        const actor = { user: { id: attempt.createdBy } };
        const [p] = await Payment.create(
          [
            {
              order: o.id,
              amountCents: attempt.amountCents,
              method: "VISA",
              provider: "stripe",
              reference: String(obj.payment_intent),
              status: "Verified",
              verifiedAt: new Date(),
            },
          ],
          { session: s },
        );
        const ar = Math.min(o.receivableCents, p.amountCents),
          deposit = p.amountCents - ar;
        await post(
          actor,
          s,
          "Verified card receipt",
          "payment:" + p.id,
          [
            line("Bank", p.amountCents),
            line("Accounts receivable", 0, ar),
            line("Customer deposits", 0, deposit),
          ],
          o.id,
        );
        o.paidCents += p.amountCents;
        o.receivableCents -= ar;
        o.depositCents += deposit;
        if (
          o.status === "Deposit pending" &&
          o.paidCents >= Math.ceil(o.productCents / 2)
        )
          o.status = "Ready to ship";
        await o.save({ session: s });
        attempt.state = "Paid";
        attempt.providerIntent = String(obj.payment_intent);
        await attempt.save({ session: s });
        await GatewayEvent.create(
          [{ eventId: event.id, type: event.type, processedAt: new Date() }],
          { session: s },
        );
        await audit(actor, s, "payment.gateway", "Payment", p.id);
      });
      res.json({ received: true });
    }),
  );
}
export function mountGatewayRoutes(app, config) {
  app.post(
    "/api/orders/:id/checkout",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const provider = gateway(config),
        o = await ownOrder(req, req.params.id);
      requireRule(
        o.acceptedAt && !["Refunded", "Return requested"].includes(o.status),
        "Order not payable",
      );
      const amountCents = cents(req.body.amount);
      requireRule(
        amountCents <= o.totalCents - o.paidCents,
        "Amount exceeds balance",
      );
      const raw = req.headers["idempotency-key"];
      requireRule(
        raw && /^[A-Za-z\d_-]{16,100}$/.test(raw),
        "Idempotency-Key required",
      );
      const key = digest(req.user.id + "|" + o.id + "|" + raw);
      let attempt = await CheckoutAttempt.findOne({ key });
      if (attempt) {
        requireRule(
          attempt.amountCents === amountCents,
          "Checkout retry amount mismatch",
        );
        if (attempt.url)
          return res.json({ attempt: attempt.id, url: attempt.url });
      } else {
        try {
          attempt = await CheckoutAttempt.create({
            order: o.id,
            createdBy: req.user.id,
            amountCents,
            key,
          });
        } catch (e) {
          if (e.code !== 11000) throw e;
          attempt = await CheckoutAttempt.findOne({ key });
          requireRule(
            attempt.amountCents === amountCents,
            "Checkout retry amount mismatch",
          );
        }
      }
      const response = await provider.create(attempt, o);
      requireRule(
        response.id &&
          response.url &&
          new URL(response.url).protocol === "https:",
        "Invalid checkout response",
      );
      attempt.providerSession = response.id;
      attempt.url = response.url;
      attempt.state = "Ready";
      await attempt.save();
      res.json({ attempt: attempt.id, url: attempt.url });
    }),
  );
}
