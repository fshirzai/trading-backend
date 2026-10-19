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
  app.get("/api/payment-methods", (req, res) =>
    res.json({
      currency: "USD",
      methods: [
        {
          method: "TT",
          enabled: true,
          verification: "Admin or Manager confirms bank funds",
        },
        {
          method: "VISA",
          enabled:
            config.gatewayProvider === "stripe" &&
            config.gatewayApproved &&
            !!config.stripeKey &&
            !!config.stripeWebhookSecret,
          reason: "Merchant provider and verified webhook integration required",
        },
      ],
    }),
  );
}
