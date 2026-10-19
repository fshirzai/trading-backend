import mongoose from "mongoose";
import { startScannerWorker } from "./modules/documents/scanner.worker.js";
import { clamScan } from "./modules/documents/scanner.service.js";
import {
  createMailer,
  startEmailWorker,
} from "./modules/email/email.service.js";
import { readConfig } from "./config.js";
import { createApp } from "./app.js";
import * as Models from "./models.js";
const config = readConfig();
await mongoose.connect(config.mongoUri, {
  maxPoolSize: 20,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10000,
  autoIndex: false,
});
const hello = await mongoose.connection.db.admin().command({ hello: 1 });
if (!hello.setName && hello.msg !== "isdbgrid")
  throw Error("MongoDB replica set or mongos required for transaction safety");
for (const Model of Object.values(Models)) await Model.createIndexes();
await mongoose.connection
  .collection("rate_limits")
  .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
if (config.mode === "production") {
  await createMailer(config).verify();
  if (!config.clamHost) throw Error("CLAMAV_HOST required in production");
  await clamScan(Buffer.from("Startup scanner check"), config);
}
const stopMail = startEmailWorker(config);
const stopScan = startScannerWorker(config);
const app = await createApp(config);
const server = app.listen(config.port, () =>
  console.log(
    JSON.stringify({
      level: "info",
      message: "Trading backend ready",
      port: config.port,
    }),
  ),
);
server.requestTimeout = 30000;
server.headersTimeout = 35000;
server.keepAliveTimeout = 5000;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopMail();
  stopScan();
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
