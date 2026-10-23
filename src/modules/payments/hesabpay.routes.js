import express from "express";
import { randomBytes } from "node:crypto";
import { HesabAccount, HesabConfig } from "./hesabpay.model.js";
import { CheckoutAttempt, GatewayEvent, Payment } from "./payments.model.js";
import { Order } from "../sales/sales.model.js";
import { User } from "../auth/auth.model.js";
import { encrypt, decrypt, digest } from "../../shared/encryption.js";
import {
  wrap,
  roles,
  tx,
  audit,
  ownOrder,
  entity,
  post,
  line,
} from "../../shared/services.js";
import { RuleError, requireRule, cents } from "../../shared/rules.js";
import { hesabRequest, convertAfn } from "./hesabpay.service.js";
export async function hesabStatus(config, admin = false) {
  const settings = await HesabConfig.findById("hesabpay").lean();
  const account = settings?.account
    ? await HesabAccount.findById(settings.account).select(
        admin ? "+callbackCipher" : "",
      )
    : null;
  return {
    revision: settings?.revision || 0,
    enabled: !!(settings?.enabled && account?.approved),
    account: account?.id || "",
    label: account?.label || "",
    environment: account?.environment || "sandbox",
    afnPerUsd: account ? account.rateMicros / 1e6 : 0,
    merchantApproved: !!account?.approved,
    configured: !!account,
    ...(admin && account
      ? {
          webhookPath:
            "/api/webhooks/hesabpay/" +
            account.id +
            "/" +
            decrypt(account.callbackCipher, config.encryptionKey),
        }
      : {}),
  };
}
export function mountHesabPublic(app, config) {
  // An independent secret callback URL binds the provider notification to this immutable merchant configuration.
  app.post(
    "/api/webhooks/hesabpay/:account/:secret",
    express.json({ limit: "100kb", strict: true }),
    wrap(async (req, res) => {
      const account = await HesabAccount.findById(req.params.account).select(
        "+apiKeyCipher +callbackHash",
      );
      requireRule(
        account && digest(req.params.secret) === account.callbackHash,
        "Invalid callback",
        400,
      );
      const b = req.body;
      requireRule(
        typeof b.signature === "string" &&
          b.signature.length <= 2048 &&
          /^\d{10,13}$/.test(String(b.timestamp)),
        "Invalid callback signature",
        400,
      );
      const ts =
        Number(b.timestamp) * (String(b.timestamp).length === 10 ? 1000 : 1);
      requireRule(
        Math.abs(Date.now() - ts) < 24 * 3600000,
        "Expired payment notification",
        400,
      );
      const verified = await hesabRequest(
        account,
        "/api/v1/hesab/webhooks/verify-signature",
        { signature: b.signature, timestamp: b.timestamp },
        config,
      );
      requireRule(verified.success === true, "Invalid gateway signature", 400);
      requireRule(
        typeof b.user_id === "string" && /^[a-f\d]{48}$/.test(b.user_id),
        "Invalid merchant reference",
        400,
      );
      const attempt = await CheckoutAttempt.findOne({
        provider: "hesabpay",
        merchantAccount: account.id,
        merchantReference: b.user_id,
      });
      requireRule(attempt, "Unknown payment reference", 400);
      if (b.success !== true || b.status_code !== 10)
        return res.json({ received: true, ignored: true });
      requireRule(
        typeof b.transaction_id === "string" &&
          /^[A-Za-z0-9_-]{1,100}$/.test(b.transaction_id),
        "Invalid transaction reference",
        400,
      );
      requireRule(
        typeof b.amount === "number" && cents(b.amount) === attempt.afnMinor,
        "Payment amount mismatch",
        400,
      );
      requireRule(
        Array.isArray(b.items) &&
          b.items.length === 1 &&
          b.items[0].id === attempt.id &&
          cents(b.items[0].price) === attempt.afnMinor,
        "Payment item mismatch",
        400,
      );
      await tx(async (s) => {
        const eventId = "hesabpay:" + b.transaction_id;
        const prior = await GatewayEvent.findOne({ eventId }).session(s);
        if (prior) {
          requireRule(
            prior.type === attempt.id,
            "Transaction already used for another order",
            409,
          );
          return;
        }
        const a = await entity(CheckoutAttempt, attempt.id, s);
        if (a.state === "Paid") return;
        const o = await entity(Order, a.order, s);
        requireRule(
          o.acceptedAt &&
            !["Return requested", "Refunded"].includes(o.status) &&
            o.paidCents + a.amountCents <= o.totalCents,
          "Order cannot accept this payment",
        );
        const actor = { user: { id: a.createdBy }, appConfig: config };
        const [p] = await Payment.create(
          [
            {
              order: o.id,
              amountCents: a.amountCents,
              method: "VISA",
              provider: "hesabpay",
              reference: "hesabpay:" + b.transaction_id,
              originalCurrency: "AFN",
              originalAmountMinor: a.afnMinor,
              exchangeRateMicros: a.exchangeRateMicros,
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
          "Verified HesabPay card receipt",
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
        a.state = "Paid";
        a.providerIntent = b.transaction_id;
        await a.save({ session: s });
        await GatewayEvent.create(
          [{ eventId, type: a.id, processedAt: new Date() }],
          { session: s },
        );
        await audit(actor, s, "payment.verify", "Payment", p.id, {
          provider: "hesabpay",
          originalAmountMinor: a.afnMinor,
        });
      });
      res.json({ received: true });
    }),
  );
}
export function mountHesab(app, config) {
  app.get(
    "/api/admin/settings/hesabpay",
    roles("admin"),
    wrap(async (req, res) => res.json(await hesabStatus(config, true))),
  );
  app.put(
    "/api/admin/settings/hesabpay",
    roles("admin"),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const current =
            (await HesabConfig.findById("hesabpay").session(s)) ||
            new HesabConfig();
          requireRule(
            current.revision === req.body.revision,
            "Payment settings changed; reload before saving",
            409,
          );
          const previous = current.account
            ? await HesabAccount.findById(current.account)
                .select("+apiKeyCipher +callbackCipher")
                .session(s)
            : null;
          requireRule(
            req.body.apiKey || previous?.apiKeyCipher,
            "Merchant API key required",
          );
          requireRule(
            !(req.body.enabled && !req.body.merchantApproved),
            "Confirm merchant approval before enabling payments",
          );
          requireRule(
            !previous ||
              previous.environment === req.body.environment ||
              req.body.apiKey,
            "A different environment requires its own API key",
          );
          const changed =
            !previous ||
            !!req.body.apiKey ||
            previous.environment !== req.body.environment;
          const secret = changed
            ? randomBytes(32).toString("hex")
            : decrypt(previous.callbackCipher, config.encryptionKey);
          let a;
          if (changed) {
            [a] = await HesabAccount.create(
              [
                {
                  label: req.body.label,
                  environment: req.body.environment,
                  apiKeyCipher: req.body.apiKey
                    ? encrypt(req.body.apiKey, config.encryptionKey)
                    : previous.apiKeyCipher,
                  callbackCipher: encrypt(secret, config.encryptionKey),
                  callbackHash: digest(secret),
                  rateMicros: Math.round(req.body.afnPerUsd * 1e6),
                  approved: req.body.merchantApproved,
                  active: true,
                  createdBy: req.user.id,
                },
              ],
              { session: s },
            );
          } else {
            a = previous;
            a.label = req.body.label;
            a.rateMicros = Math.round(req.body.afnPerUsd * 1e6);
            a.approved = req.body.merchantApproved;
            await a.save({ session: s });
          }
          current.account = a.id;
          current.enabled = req.body.enabled;
          current.revision++;
          await current.save({ session: s });
          await audit(
            req,
            s,
            "settings.hesabpay.update",
            "HesabConfig",
            "hesabpay",
            {
              label: a.label,
              environment: a.environment,
              enabled: current.enabled,
              rateMicros: a.rateMicros,
              previousAccount: previous?.id,
              account: a.id,
            },
          );
          return {
            revision: current.revision,
            enabled: current.enabled,
            account: a.id,
            label: a.label,
            environment: a.environment,
            afnPerUsd: a.rateMicros / 1e6,
            merchantApproved: a.approved,
            configured: true,
            webhookPath: "/api/webhooks/hesabpay/" + a.id + "/" + secret,
          };
        }),
      ),
    ),
  );
  app.post(
    "/api/orders/:id/hesabpay-checkout",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const status = await hesabStatus(config);
      requireRule(status.enabled, "HesabPay is not enabled", 503);
      const o = await ownOrder(req, req.params.id);
      requireRule(
        o.acceptedAt && !["Refunded", "Return requested"].includes(o.status),
        "Order not payable",
      );
      const amount = cents(req.body.amount);
      requireRule(
        amount <= o.totalCents - o.paidCents,
        "Amount exceeds balance",
      );
      const raw = req.headers["idempotency-key"];
      requireRule(
        raw && /^[A-Za-z\d_-]{16,100}$/.test(raw),
        "Idempotency-Key required",
      );
      const key = digest("hesabpay|" + req.user.id + "|" + o.id + "|" + raw);
      let a = await CheckoutAttempt.findOne({ key }).select(
        "+merchantReference",
      );
      if (a) {
        requireRule(
          a.amountCents === amount &&
            String(a.merchantAccount) === req.body.expectedAccount &&
            a.afnMinor === req.body.expectedAfnMinor,
          "Checkout retry changed",
          409,
        );
        if (a.url)
          return res.json({
            attempt: a.id,
            url: a.url,
            afnMinor: a.afnMinor,
            rateMicros: a.exchangeRateMicros,
          });
        throw new RuleError(
          "Checkout is being created or needs reconciliation; do not start another charge",
          409,
        );
      }
      const account = await HesabAccount.findById(status.account).select(
        "+apiKeyCipher",
      );
      const afnMinor = convertAfn(amount, account.rateMicros);
      requireRule(afnMinor >= 4000, "Card payment must be at least 40 AFN");
      requireRule(
        req.body.expectedAccount === account.id &&
          req.body.expectedAfnMinor === afnMinor,
        "Merchant or exchange rate changed; review the new amount",
        409,
      );
      a = await CheckoutAttempt.create({
        provider: "hesabpay",
        merchantAccount: account.id,
        merchantReference: randomBytes(24).toString("hex"),
        afnMinor,
        exchangeRateMicros: account.rateMicros,
        order: o.id,
        createdBy: req.user.id,
        amountCents: amount,
        key,
        currency: "afn",
      });
      const user = await User.findById(req.user.id);
      const result = await hesabRequest(
        account,
        "/api/v1/payment/create-session",
        {
          user_id: a.merchantReference,
          email: user.email,
          items: [{ id: a.id, name: "Order " + o.id, price: afnMinor / 100 }],
          redirect_success_url:
            config.frontendUrl + "/?payment=returned#workspace/sales/" + o.id,
          redirect_failure_url:
            config.frontendUrl + "/?payment=failed#workspace/sales/" + o.id,
        },
        config,
      );
      let url;
      try {
        url = new URL(result.url);
      } catch {
        throw new RuleError("Invalid HesabPay checkout URL", 502);
      }
      requireRule(
        result.success === true &&
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          (url.hostname === "hesab.com" || url.hostname.endsWith(".hesab.com")),
        "Invalid HesabPay checkout response",
        502,
      );
      a.url = url.href;
      a.providerSession = a.id;
      a.state = "Ready";
      await a.save();
      res.json({
        attempt: a.id,
        url: a.url,
        afnMinor,
        rateMicros: a.exchangeRateMicros,
      });
    }),
  );
}
