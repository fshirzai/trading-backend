import { hesabStatus } from "./hesabpay.routes.js";
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
export function mountPaymentsMaintenance(app, config) {
  app.get(
    "/api/payment-methods",
    wrap(async (req, res) => {
      const hesab = await hesabStatus(config);
      return res.json({
        currency: "USD",
        methods: [
          {
            method: "TT",
            enabled: true,
            verification: "Admin or Manager confirms bank funds",
          },
          {
            method: "VISA",
            provider: hesab.enabled ? "hesabpay" : "stripe",
            checkoutPath: hesab.enabled ? "hesabpay-checkout" : "checkout",
            hesabpay: hesab,
            enabled:
              hesab.enabled ||
              (config.gatewayProvider === "stripe" &&
                config.gatewayApproved &&
                !!config.stripeKey &&
                !!config.stripeWebhookSecret),
            reason:
              "Merchant provider and verified webhook integration required",
          },
        ],
      });
    }),
  );
}
