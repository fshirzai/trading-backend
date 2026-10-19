import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { seedDemo } from "../src/database/seed.service.js";
import * as M from "../src/models.js";
let repl,
  app,
  tokens = {},
  ids;
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  await mongoose.connect(repl.getUri());
  for (const m of Object.values(M)) await m.init();
  const config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: repl.getUri(),
    JWT_SECRET: randomBytes(64).toString("hex"),
  });
  const password = "Workspace-Seed-Password-94!";
  ids = await seedDemo(config, password);
  app = await createApp(config);
  for (const role of [
    "admin",
    "manager",
    "seller",
    "procurement",
    "customer",
  ]) {
    const r = await request(app)
      .post("/api/auth/login")
      .send({ email: role + "@demo.test", password });
    assert.equal(r.status, 200);
    tokens[role] = r.body.accessToken;
  }
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
const get = (role, url) =>
  request(app)
    .get("/api" + url)
    .set("Authorization", "Bearer " + tokens[role]);
test("staff listing exposes only safe public fields and enforces roles", async () => {
  await M.User.updateOne(
    { email: "seller@demo.test" },
    {
      $set: { mfaSecret: "secret-marker", recoveryHashes: ["private-marker"] },
    },
  );
  const admin = await get("admin", "/users");
  assert.equal(admin.status, 200);
  assert.ok(admin.body.items.length);
  for (const user of admin.body.items)
    for (const key of [
      "passwordHash",
      "mfaSecret",
      "mfaPendingSecret",
      "recoveryHashes",
      "tokenVersion",
      "loginFailures",
    ])
      assert.equal(user[key], undefined);
  const manager = await get("manager", "/users");
  assert.ok(
    manager.body.items.every((u) => ["seller", "procurement"].includes(u.role)),
  );
  assert.equal((await get("customer", "/users")).status, 403);
  assert.equal((await get("seller", "/users")).status, 403);
});
test("dashboard aggregates all rows and isolates customer scope", async () => {
  const party = await M.Party.findById(ids.customer);
  const other = await M.Party.create({
    name: "Other customer",
    type: "customer",
  });
  for (let i = 0; i < 30; i++)
    await M.Order.create({
      customer: party.id,
      product: ids.product,
      quantity: 1,
      productCents: 10000,
      totalCents: 10000,
      paidCents: 5000,
      border: "Torkham",
      status: "Deposit pending",
    });
  await M.Order.create({
    customer: other.id,
    product: ids.product,
    quantity: 1,
    productCents: 990000,
    totalCents: 990000,
    border: "Torkham",
  });
  const customer = await get("customer", "/workspace/summary");
  assert.equal(customer.status, 200);
  assert.equal(customer.body.totals.orders, 30);
  assert.equal(customer.body.totals.totalCents, 300000);
  assert.equal(customer.body.inventory, null);
  assert.equal(customer.body.recent.length, 5);
  const admin = await get("admin", "/workspace/summary");
  assert.equal(admin.body.totals.orders, 31);
  assert.ok(admin.body.inventory);
  assert.ok(admin.body.recent[0]._labels.product.en);
});
test("order document listing requires ownership and strips scanner details", async () => {
  const own = await M.Order.findOne({
    customer: (await M.Party.findById(ids.customer)).id,
  });
  const foreign = await M.Order.findOne({ totalCents: 990000 });
  await M.Document.create({
    owner: (await M.Party.findById(ids.customer)).userId,
    order: own.id,
    kind: "payment-receipt",
    name: "receipt.pdf",
    mime: "application/pdf",
    size: 100,
    sha256: "secret-digest",
    lastScanError: "private diagnostic",
  });
  const r = await get("customer", `/orders/${own.id}/documents`);
  assert.equal(r.status, 200);
  assert.equal(r.body.items[0].name, "receipt.pdf");
  assert.equal(r.body.items[0].sha256, undefined);
  assert.equal(r.body.items[0].lastScanError, undefined);
  assert.equal(
    (await get("customer", `/orders/${foreign.id}/documents`)).status,
    404,
  );
  assert.equal(
    (await get("procurement", `/orders/${own.id}/documents`)).status,
    403,
  );
});
test("display labels do not expose authentication material", async () => {
  const r = await get("admin", "/records/purchase");
  assert.equal(r.status, 200);
  assert.ok(r.body.items[0]._labels.supplier);
  assert.ok(r.body.items[0]._labels.product);
  assert.ok(!JSON.stringify(r.body).includes("secret-marker"));
});
