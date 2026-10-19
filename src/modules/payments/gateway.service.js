import Stripe from "stripe";
import { RuleError } from "../../shared/rules.js";
export function gateway(config) {
  if (config.mode === "test" && config.gateway) return config.gateway;
  if (
    config.gatewayProvider !== "stripe" ||
    !config.stripeKey ||
    !config.stripeWebhookSecret ||
    !config.gatewayApproved
  )
    throw new RuleError("USD card gateway is not configured and approved", 503);
  const stripe =
    config.mode === "test" && config.stripeClient
      ? config.stripeClient
      : new Stripe(config.stripeKey, {
          timeout: 10000,
          maxNetworkRetries: 2,
        });
  return {
    create: async (a, order) =>
      stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: { name: "Trading order " + order.id },
                unit_amount: a.amountCents,
              },
              quantity: 1,
            },
          ],
          client_reference_id: a.id,
          metadata: { attempt: a.id, order: order.id },
          success_url:
            new URL("/payment/success", config.frontendUrl).href +
            "?session_id={CHECKOUT_SESSION_ID}",
          cancel_url: new URL("/payment/cancelled", config.frontendUrl).href,
        },
        { idempotencyKey: a.key },
      ),
    verify: (body, signature) =>
      stripe.webhooks.constructEvent(
        body,
        signature,
        config.stripeWebhookSecret,
        300,
      ),
    retrieveRefund: async (id) => stripe.refunds.retrieve(id),
    refund: async (intent, amount, key) =>
      stripe.refunds.create(
        { payment_intent: intent, amount },
        { idempotencyKey: key },
      ),
  };
}
