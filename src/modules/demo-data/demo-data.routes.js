import rateLimit from "express-rate-limit";
import { MongoRateStore } from "../platform/rate-limit.store.js";
import { User } from "../../models.js";
import { SeedRun } from "../../database/seed.service.js";
import { wrap, roles } from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
import { verifyPassword } from "../auth/password.service.js";
import { addAdminDemoData, DEMO_KEY } from "./demo-data.service.js";
export function mountDemoData(app, config) {
  app.get(
    "/api/admin/demo-data",
    roles("admin"),
    wrap(async (req, res) => {
      const prior = await SeedRun.findOne({ key: DEMO_KEY }).lean();
      res.json({
        enabled: !!config.demoDataEnabled,
        seeded: !!prior,
        result: prior?.result || null,
      });
    }),
  );
  app.post(
    "/api/admin/demo-data",
    roles("admin"),
    rateLimit({
      windowMs: 15 * 60000,
      limit: 5,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      store: new MongoRateStore("admin-demo"),
      message: { error: "Too many demo-data attempts; try again later" },
    }),
    wrap(async (req, res) => {
      requireRule(
        config.demoDataEnabled,
        "Demo data is disabled; enable DEMO_DATA_ENABLED temporarily",
        403,
      );
      const admin = await User.findById(req.user.id).select("+passwordHash");
      requireRule(
        admin &&
          (await verifyPassword(req.body.adminPassword, admin.passwordHash)),
        "Administrator password is incorrect",
        403,
      );
      res.json(await addAdminDemoData(req, config, req.body.demoPassword));
    }),
  );
}
