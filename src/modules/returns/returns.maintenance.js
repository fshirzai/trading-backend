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
export function mountReturnsMaintenance(app, config) {
  app.post(
    "/api/returns/:id/reject",
    manage,
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const r = await entity(M.Return, req.params.id, s);
          requireRule(r.status === "Requested", "Return already processed");
          const o = await entity(M.Order, r.order, s);
          r.status = "Rejected";
          r.rejectionReason = req.body.reason;
          o.status = r.previousStatus;
          await r.save({ session: s });
          await o.save({ session: s });
          await audit(req, s, "return.reject", "Return", r.id, {
            reason: req.body.reason,
          });
          return r;
        }),
      );
    }),
  );
}
