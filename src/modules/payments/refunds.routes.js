import { CardRefund, Payment } from "./payments.model.js";
import { Return } from "../returns/returns.model.js";
import { gateway } from "./gateway.service.js";
import { wrap, tx, manage, entity, audit } from "../../shared/services.js";
import { digest } from "../../shared/encryption.js";
import { cents, requireRule, RuleError } from "../../shared/rules.js";
export function mountCardRefunds(app, config) {
  app.post(
    "/api/returns/:id/card-refunds",
    manage,
    wrap(async (req, res) => {
      const provider = gateway(config),
        raw = req.headers["idempotency-key"];
      requireRule(
        raw && /^[A-Za-z\d_-]{16,100}$/.test(raw),
        "Idempotency-Key required",
      );
      const key = digest(req.user.id + "|" + req.params.id + "|" + raw),
        amount = cents(req.body.amount);
      let refund = await CardRefund.findOne({ key });
      if (refund) {
        requireRule(
          refund.amountCents === amount &&
            String(refund.payment) === req.body.payment,
          "Refund retry mismatch",
        );
        if (refund.status === "Succeeded") return res.json(refund);
      } else {
        refund = await tx(async (s) => {
          const r = await entity(Return, req.params.id, s),
            p = await entity(Payment, req.body.payment, s);
          requireRule(
            r.status === "Requested" && req.body.inspectionPassed,
            "Inspect returned products before refund",
          );
          requireRule(
            String(p.order) === String(r.order) &&
              p.method === "VISA" &&
              p.status === "Verified",
            "Verified card payment for this order required",
          );
          const reserved = await CardRefund.find({
              return: r.id,
              status: { $in: ["Pending", "Succeeded"] },
            }).session(s),
            allocated = reserved.reduce((v, x) => v + x.amountCents, 0),
            perPayment = await CardRefund.find({
              payment: p.id,
              status: { $in: ["Pending", "Succeeded"] },
            }).session(s);
          requireRule(
            allocated + amount <= r.refundCents &&
              perPayment.reduce((v, x) => v + x.amountCents, 0) + amount <=
                p.amountCents,
            "Refund exceeds available amount",
          );
          r.cardRefundReservedCents = (r.cardRefundReservedCents || 0) + amount;
          await r.save({ session: s });
          const [item] = await CardRefund.create(
            [{ return: r.id, payment: p.id, amountCents: amount, key }],
            { session: s },
          );
          return item;
        });
      }
      const p = await entity(Payment, refund.payment);
      const result =
        refund.providerId && provider.retrieveRefund
          ? await provider.retrieveRefund(refund.providerId)
          : await provider.refund(p.reference, refund.amountCents, refund.key);
      requireRule(result.id, "Invalid provider refund");
      await CardRefund.updateOne(
        { _id: refund.id },
        { $set: { providerId: result.id } },
      );
      if (["failed", "canceled"].includes(result.status)) {
        await tx(async (s) => {
          const r = await entity(Return, refund.return, s),
            f = await entity(CardRefund, refund.id, s);
          if (f.status === "Pending") {
            f.status = "Failed";
            r.cardRefundReservedCents -= f.amountCents;
            await f.save({ session: s });
            await r.save({ session: s });
          }
        });
        throw new RuleError("Provider refund failed", 502);
      }
      requireRule(
        result.status === "succeeded",
        "Provider refund is pending; retry after confirmation",
      );
      await tx(async (s) => {
        const current = await entity(CardRefund, refund.id, s);
        if (current.status !== "Succeeded") {
          current.status = "Succeeded";
          current.providerId = result.id;
          await current.save({ session: s });
          await audit(req, s, "refund.gateway", "CardRefund", current.id);
        }
      });
      res.json(await CardRefund.findById(refund.id));
    }),
  );
}
