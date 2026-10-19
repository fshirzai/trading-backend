import { Notification } from "./notifications.model.js";
import { wrap, entity, list } from "../../shared/services.js";
import { RuleError } from "../../shared/rules.js";
export function mountNotifications(app) {
  app.get(
    "/api/notifications",
    wrap(async (req, res) =>
      res.json(await list(Notification, { user: req.user.id }, req.query)),
    ),
  );
  app.post(
    "/api/notifications/:id/read",
    wrap(async (req, res) => {
      const n = await entity(Notification, req.params.id);
      if (String(n.user) !== req.user.id)
        throw new RuleError("Record not found", 404);
      if (!n.readAt) {
        n.readAt = new Date();
        await n.save();
      }
      res.json({ id: n.id, readAt: n.readAt });
    }),
  );
}
