import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";
import { EmailToken, EmailJob } from "./email.model.js";
import { encrypt, decrypt, digest } from "../../shared/encryption.js";
import { requireRule, RuleError } from "../../shared/rules.js";
export function createMailer(config) {
  if (config.mode === "test" && config.mailer) return config.mailer;
  if (!config.smtpHost)
    return {
      send: async () => {
        throw new RuleError("SMTP is not configured", 503);
      },
      verify: async () => {
        throw new Error("SMTP is not configured");
      },
    };
  const factory =
    config.mode === "test" && config.transportFactory
      ? config.transportFactory
      : nodemailer.createTransport;
  const transport = factory({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    requireTLS: config.smtpPort !== 465,
    auth: { user: config.smtpUser, pass: config.smtpPassword },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    send: async (payload) => {
      await transport.sendMail({ from: config.mailFrom, ...payload });
    },
    verify: () => transport.verify(),
  };
}
export async function queueToken(user, kind, config, session) {
  const token = randomBytes(32).toString("hex"),
    expiresAt = new Date(Date.now() + 5 * 60000);
  await EmailToken.updateMany(
    { user: user.id, kind, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    { session },
  );
  await EmailToken.create(
    [{ user: user.id, kind, tokenHash: digest(token), expiresAt }],
    { session },
  );
  const url = new URL(
    kind === "verify" ? "/verify-email" : "/reset-password",
    config.frontendUrl,
  );
  url.searchParams.set("token", token);
  const payload = {
    to: user.email,
    subject: kind === "verify" ? "Verify your email" : "Reset your password",
    text: `${kind === "verify" ? "Verify your email" : "Reset your password"}: ${url}\nThis link expires in 5 minutes. If you did not request this, ignore this email.`,
  };
  await EmailJob.create(
    [
      {
        payload: encrypt(JSON.stringify(payload), config.encryptionKey),
        availableAt: new Date(),
        validUntil: expiresAt,
      },
    ],
    { session },
  );
  return token;
}
export async function deliverOne(config) {
  const now = new Date();
  const job = await EmailJob.findOneAndUpdate(
    {
      $or: [
        { state: "Queued", availableAt: { $lte: now } },
        { state: "Sending", lockedUntil: { $lte: now } },
      ],
    },
    {
      $set: { state: "Sending", lockedUntil: new Date(Date.now() + 60000) },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { createdAt: 1 } },
  );
  if (!job) return false;
  if (job.validUntil <= now) {
    await EmailJob.updateOne(
      { _id: job.id },
      { $set: { state: "Failed", lastError: "Expired before delivery" } },
    );
    return true;
  }
  try {
    await createMailer(config).send(
      JSON.parse(decrypt(job.payload, config.encryptionKey)),
    );
    await EmailJob.updateOne(
      { _id: job.id, lockedUntil: job.lockedUntil },
      {
        $set: {
          state: "Sent",
          sentAt: new Date(),
          payload: encrypt("{}", config.encryptionKey),
        },
        $unset: { lockedUntil: 1, lastError: 1 },
      },
    );
  } catch {
    await EmailJob.updateOne(
      { _id: job.id, lockedUntil: job.lockedUntil },
      {
        $set: {
          state: job.attempts >= 5 ? "Failed" : "Queued",
          lastError: "Delivery failed",
          availableAt: new Date(
            Date.now() + Math.min(60000, 1000 * 2 ** job.attempts),
          ),
        },
        $unset: { lockedUntil: 1 },
      },
    );
  }
  return true;
}
export function startEmailWorker(config) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await deliverOne(config);
    } catch {
      console.error(
        JSON.stringify({ level: "error", message: "Email worker failed" }),
      );
    } finally {
      busy = false;
    }
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
