import mongoose from "mongoose";
import { waitUntil } from "@vercel/functions";
import { createApp } from "../../app.js";
import { readConfig } from "../../config.js";
import * as Models from "../../models.js";
import { createVercelHandler } from "./vercel-handler.js";
import { drainEmailJobs } from "../email/serverless-email.service.js";

async function initialize() {
  const config = readConfig();
  if (config.documentUploadsEnabled)
    throw Error(
      "Set DOCUMENT_UPLOADS_ENABLED=false on Vercel; uploaded files require durable storage and scanning",
    );
  if (
    !config.smtpHost ||
    !config.smtpUser ||
    !config.smtpPassword ||
    !config.mailFrom
  )
    throw Error(
      "SMTP_HOST, SMTP_USER, SMTP_PASSWORD and MAIL_FROM required on Vercel",
    );
  await mongoose.connect(config.mongoUri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    maxIdleTimeMS: 60000,
    serverSelectionTimeoutMS: 10000,
    autoIndex: false,
  });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid")
    throw Error(
      "MongoDB replica set or mongos required for transaction safety",
    );
  for (const Model of Object.values(Models)) await Model.createIndexes();
  await mongoose.connection
    .collection("rate_limits")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return { app: await createApp(config), config };
}

export default createVercelHandler({
  initialize,
  waitUntil,
  drainEmails: drainEmailJobs,
});
