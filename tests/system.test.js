import sharp from "sharp";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import * as M from "../src/models.js";
import { readConfig } from "../src/config.js";
import { seedDemo } from "../src/database/seed.service.js";
import { randomUUID } from "node:crypto";
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
test("seeded system runs a complete trade through an actual HTTP server process", async () => {
  const repl = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  let child;
  try {
    await mongoose.connect(repl.getUri());
    for (const m of Object.values(M)) await m.init();
    const config = readConfig({
        NODE_ENV: "test",
        MONGODB_URI: repl.getUri(),
        JWT_SECRET: "s".repeat(64),
      }),
      password = "System-Seed-Password-94!",
      ids = await seedDemo(config, password),
      again = await seedDemo(config, password);
    assert.equal(ids.customer, String(again.customer));
    assert.equal(await M.User.countDocuments(), 5);
    const port = await freePort();
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        MONGODB_URI: repl.getUri(),
        JWT_SECRET: "s".repeat(64),
        PORT: String(port),
        WEB_ORIGINS: "http://localhost:3000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(
        () => reject(Error("Server did not become ready")),
        15000,
      );
      child.stdout.on("data", (x) => {
        if (x.toString().includes("Trading backend ready")) {
          clearTimeout(t);
          resolve();
        }
      });
      child.on("exit", (c) => {
        clearTimeout(t);
        reject(Error("Server exited " + c));
      });
    });
    const base = "http://127.0.0.1:" + port + "/api",
      tokens = {};
    async function call(role, method, url, body, expected = 200) {
      const response = await fetch(base + url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
          ...(tokens[role] ? { Authorization: "Bearer " + tokens[role] } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      assert.equal(response.status, expected, url + " " + text);
      return text ? JSON.parse(text) : null;
    }
    for (const role of ["admin", "seller", "procurement", "customer"]) {
      const r = await call("", "POST", "/auth/login", {
        email: role + "@demo.test",
        password,
      });
      tokens[role] = r.accessToken;
    }
    await call("admin", "GET", "/health/ready");
    await call("admin", "GET", "/accounting/accounts");
    const inquiry = await call(
        "customer",
        "POST",
        "/inquiries",
        { product: ids.product, quantity: 10 },
        201,
      ),
      order = await call(
        "seller",
        "POST",
        "/inquiries/" + inquiry._id + "/proforma",
        { productTotal: 1000, border: "Hairatan", splitIncluded: true },
        201,
      );
    await call("customer", "POST", "/orders/" + order._id + "/accept", {});
    async function pay(ref) {
      const bytes = await sharp({
        create: { width: 80, height: 60, channels: 3, background: "#ffffff" },
      })
        .png()
        .toBuffer();
      const uploaded = await fetch(
        base + "/orders/" + order._id + "/receipts",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + tokens.customer,
            "Content-Type": "image/png",
          },
          body: bytes,
        },
      );
      assert.equal(uploaded.status, 201);
      const receipt = await uploaded.json();
      const p = await call(
        "customer",
        "POST",
        "/orders/" + order._id + "/payments",
        { amount: 500, method: "TT", reference: ref, receiptKey: receipt.id },
        201,
      );
      await call("admin", "POST", "/payments/" + p._id + "/verify", {
        bankFundsConfirmed: true,
      });
    }
    await pay("SYSTEM-1");
    const shipment = await call(
      "seller",
      "POST",
      "/orders/" + order._id + "/shipments",
      {
        quantity: 10,
        warehouse: ids.warehouse,
        driver: "Driver",
        vehicle: "TRUCK-1",
      },
      201,
    );
    await pay("SYSTEM-2");
    await call("seller", "POST", "/shipments/" + shipment._id + "/handover", {
      recipient: "Customer",
      proof: "Signed delivery",
    });
    const ret = await call(
      "customer",
      "POST",
      "/orders/" + order._id + "/returns",
      { reason: "Inspection return" },
      201,
    );
    assert.equal(ret.refundCents, 75000);
    await call("admin", "POST", "/returns/" + ret._id + "/complete", {
      returnedQuantity: 10,
      warehouse: ids.warehouse,
      inspectionPassed: true,
      refundConfirmed: true,
      note: "Goods checked in delivered condition",
    });
    const balances = await call("admin", "GET", "/reports/balance-sheet");
    assert.equal(balances.balanced, true);
    const stocks = await call("procurement", "GET", "/records/batch");
    assert.equal(
      stocks.items.reduce((v, b) => v + b.quantity, 0),
      100,
    );
    const o = await M.Order.findById(order._id);
    assert.equal(o.status, "Refunded");
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
    child = null;
  } finally {
    if (child) child.kill("SIGKILL");
    await mongoose.disconnect();
    await repl.stop();
  }
});
