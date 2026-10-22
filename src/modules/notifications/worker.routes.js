import { timingSafeEqual } from "node:crypto";
import {
  wrap,
  manage,
  list,
  tx,
  entity,
  audit,
} from "../../shared/services.js";
import { RuleError, requireRule } from "../../shared/rules.js";
import { EmailJob } from "../../models.js";
import { drainEmailJobs } from "../email/serverless-email.service.js";
export function mountWorkerPublic(app, config) {
  // Invoked by an external scheduler. This is registered before account authentication.
  app.post(
    "/api/jobs/notifications",
    wrap(async (req, res) => {
      const raw = req.headers.authorization || "";
      const expected = "Bearer " + (config.notificationKey || "");
      if (
        !config.notificationKey ||
        config.notificationKey.length < 32 ||
        raw.length !== expected.length ||
        !timingSafeEqual(Buffer.from(raw), Buffer.from(expected))
      )
        throw new RuleError("Unauthorized worker", 401);
      res.json({
        processed: await drainEmailJobs(config, {
          budgetMs: 20000,
          maxJobs: 10,
        }),
      });
    }),
  );
}
export function mountNotificationDelivery(app) {
  app.post(
    "/api/notification-delivery/:id/retry",
    manage,
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const job = await entity(EmailJob, req.params.id, s);
          requireRule(
            job.state === "Failed" && job.validUntil > new Date(),
            "Only unexpired failed messages can be retried",
          );
          job.state = "Queued";
          job.attempts = 0;
          job.availableAt = new Date();
          job.lastError = undefined;
          await job.save({ session: s });
          await audit(req, s, "email.retry", "EmailJob", job.id);
          return { id: job.id, state: job.state };
        }),
      ),
    ),
  );
  app.get(
    "/api/notification-delivery",
    manage,
    wrap(async (req, res) => {
      res.json(
        await list(EmailJob, {}, req.query, {
          select:
            "notification state attempts availableAt lastError sentAt createdAt",
        }),
      );
    }),
  );
}
