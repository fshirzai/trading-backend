import mongoose from "mongoose";
import { readConfig } from "../src/config.js";
import { seedDemo } from "../src/database/seed.service.js";
import * as M from "../src/models.js";
const config = readConfig();
await mongoose.connect(config.mongoUri);
try {
  for (const m of Object.values(M)) await m.init();
  await seedDemo(config, process.env.SEED_PASSWORD);
  console.log(
    "Demo data seeded. Accounts: admin/manager/seller/procurement/customer @demo.test. Password is the SEED_PASSWORD you supplied.",
  );
} finally {
  await mongoose.disconnect();
}
