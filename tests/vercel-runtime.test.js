import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import handler from "../src/app.js";
import { Product } from "../src/models.js";

test("actual default entrypoint initializes MongoDB and serves readiness and catalog over HTTP", async () => {
  const repl = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  const env = {
    NODE_ENV: "production",
    MONGODB_URI: repl.getUri(),
    JWT_SECRET: "v".repeat(64),
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    WEB_ORIGINS: "https://frontend.example",
    FRONTEND_URL: "https://frontend.example",
    TRUST_PROXY_HOPS: "1",
    RETURN_POLICY_CONFIRMED: "true",
    DOCUMENT_UPLOADS_ENABLED: "false",
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "fixture",
    SMTP_PASSWORD: "fixture-not-a-real-password",
    MAIL_FROM: "sender@example.test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  let error;
  const server = http.createServer((req, res) => {
    handler(req, res).catch((e) => {
      error = e;
      res.writeHead(500).end("Failed");
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const ready = await fetch(origin + "/api/health/ready");
    assert.equal(ready.status, 200, String(error));
    assert.deepEqual(await ready.json(), { status: "ready" });
    await Product.create({ name: { en: "Adapter test beans" }, active: true });
    const catalog = await fetch(origin + "/api/catalog", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).items[0].name.en, "Adapter test beans");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    await repl.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
