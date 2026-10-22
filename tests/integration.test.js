import sharp from "sharp";
import { randomUUID } from "node:crypto";
import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import * as M from "../src/models.js";
import { hashPassword } from "../src/modules/auth/password.service.js";
let repl, app, config, passwordHash, dir, tokens, parties;
test("disabled uploaded documents reject upload, download and scan without changing records", async () => {
  const disabled = await createApp({
    ...config,
    documentUploadsEnabled: false,
  });
  const id = new mongoose.Types.ObjectId().toString();
  const before = await M.Document.countDocuments();
  const upload = await request(disabled)
    .post(`/api/orders/${id}/documents`)
    .set("Authorization", "Bearer " + tokens.admin)
    .set("Content-Type", "application/pdf")
    .send(Buffer.from("%PDF-test"));
  assert.equal(upload.status, 503);
  assert.match(upload.body.error, /disabled/);
  await request(disabled)
    .get(`/api/documents/${id}`)
    .set("Authorization", "Bearer " + tokens.admin)
    .expect(503);
  await request(disabled)
    .post(`/api/documents/${id}/scan`)
    .set("Authorization", "Bearer " + tokens.admin)
    .expect(503);
  assert.equal(await M.Document.countDocuments(), before);
  await request(disabled).get("/api/health/ready").expect(200);
});
const password = "Correct-Horse-Battery-92!";
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  await mongoose.connect(repl.getUri(), { maxPoolSize: 10 });
  for (const Model of Object.values(M)) await Model.init();
  dir = await mkdtemp(path.join(os.tmpdir(), "trading-files-"));
  config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: repl.getUri(),
    JWT_SECRET: "c".repeat(64),
    WEB_ORIGINS: "http://localhost:3000",
    UPLOAD_DIR: dir,
  });
  config.scanner = async () => ({ clean: true, engine: "test" });
  passwordHash = await hashPassword(password, 16384);
  app = await createApp(config);
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const c of Object.values(mongoose.connection.collections))
    await c.deleteMany({});
  tokens = {};
  parties = {};
  for (const role of [
    "admin",
    "manager",
    "seller",
    "procurement",
    "customer",
    "other",
  ]) {
    const u = await M.User.create({
      name: role,
      email: role + "@example.com",
      passwordHash,
      emailVerified: true,
      role: role === "other" ? "customer" : role,
    });
    if (["customer", "other"].includes(role))
      parties[role] = await M.Party.create({
        name: role,
        type: "customer",
        country: "China",
        userId: u.id,
      });
    const r = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[role] = r.body.accessToken;
  }
});
async function call(role, method, url, body, status = 200) {
  if (
    role === "customer" &&
    method === "post" &&
    /\/payments$/.test(url) &&
    status === 201 &&
    !body.receiptKey
  ) {
    const bytes = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const receipt = await request(app)
      .post("/api" + url.replace(/payments$/, "receipts"))
      .set("Authorization", "Bearer " + tokens[role])
      .set("Content-Type", "image/png")
      .send(bytes)
      .expect(201);
    body = { ...body, receiptKey: receipt.body.id };
  }
  const req = request(app)
    [method]("/api" + url)
    .set("Authorization", "Bearer " + tokens[role])
    .set("Idempotency-Key", randomUUID());
  if (body !== undefined) req.send(body);
  const r = await req;
  assert.equal(
    r.status,
    status,
    method + " " + url + " " + JSON.stringify(r.body),
  );
  return r.body;
}
async function createOrder(
  qty = 100,
  total = 10000,
  { paid = 5000, splitIncluded = true } = {},
) {
  const product = await call(
    "admin",
    "post",
    "/records/product",
    { name: { en: "Beans", ps: "لوبیا", fa: "لوبیا" }, moq: 0 },
    201,
  );
  const warehouse = await call(
    "admin",
    "post",
    "/records/warehouse",
    { name: "Kabul", country: "Afghanistan" },
    201,
  );
  const inquiry = await call(
    "customer",
    "post",
    "/inquiries",
    { product: product._id, quantity: qty },
    201,
  );
  const order = await call(
    "seller",
    "post",
    "/inquiries/" + inquiry._id + "/proforma",
    { productTotal: total, deliveryFees: 0, border: "Hairatan", splitIncluded },
    201,
  );
  await call("customer", "post", "/orders/" + order._id + "/accept", {});
  if (paid) await pay(order._id, paid);
  return { product, warehouse, order };
}
async function pay(order, amount, reference = "TT-" + Math.random()) {
  const p = await call(
    "customer",
    "post",
    "/orders/" + order + "/payments",
    { amount, method: "TT", reference },
    201,
  );
  await call("admin", "post", "/payments/" + p._id + "/verify", {
    bankFundsConfirmed: true,
  });
  return p;
}
async function stock(product, warehouse, qty = 100, cost = 6000) {
  const supplier = await call(
    "procurement",
    "post",
    "/records/party",
    { name: "Supplier", type: "supplier" },
    201,
  );
  const p = await call(
    "procurement",
    "post",
    "/purchases",
    {
      supplier: supplier._id,
      product: product._id,
      quantity: qty,
      totalCost: cost,
    },
    201,
  );
  const b = await call(
    "procurement",
    "post",
    "/purchases/" + p._id + "/receive",
    { warehouse: warehouse._id, batchCode: "B-" + Math.random() },
  );
  return { p, b };
}
async function ship(order, warehouse, quantity, extra = {}, status = 201) {
  return call(
    "seller",
    "post",
    "/orders/" + order._id + "/shipments",
    {
      quantity,
      direct: false,
      warehouse: warehouse._id,
      driver: "Ahmad",
      vehicle: "KBL-111",
      additionalFee: 0,
      feeAccepted: false,
      ...extra,
    },
    status,
  );
}

test("security headers, strict input, NoSQL injection, CORS and request IDs", async () => {
  const r = await request(app).get("/api/health/live");
  assert.equal(r.status, 200);
  assert.equal(r.headers["x-powered-by"], undefined);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.ok(r.headers["x-request-id"]);
  await request(app)
    .post("/api/auth/login")
    .send({ email: { $ne: null }, password })
    .expect(422);
  await request(app)
    .post("/api/auth/register")
    .send({
      name: "Hacker",
      email: "hacker@example.com",
      password,
      role: "admin",
    })
    .expect(422);
  await request(app)
    .get("/api/me")
    .set("Origin", "https://evil.example")
    .expect(403);
  await request(app).get("/api/me").expect(401);
  await call("admin", "get", "/records/product?limit=9999", undefined, 400);
  await call("admin", "get", "/records/product?filter[$ne]=x", undefined, 400);
  await request(app)
    .post("/api/auth/login")
    .set("Content-Type", "application/json")
    .send("{bad")
    .expect(400);
  await request(app)
    .post("/api/auth/login")
    .send({ email: "a@example.com", password: "x".repeat(110000) })
    .expect(413);
});

test("customer isolation and role boundaries", async () => {
  const { order } = await createOrder();
  await call("other", "get", "/orders/" + order._id, undefined, 404);
  const list = await call("other", "get", "/orders");
  assert.equal(list.items.length, 0);
  await call("customer", "get", "/records/journal", undefined, 403);
  await call(
    "seller",
    "post",
    "/journals",
    {
      memo: "Unauthorized",
      lines: [
        { account: "Bank", debitCents: 100, creditCents: 0 },
        { account: "Owner capital", debitCents: 0, creditCents: 100 },
      ],
    },
    403,
  );
  await call(
    "manager",
    "post",
    "/users",
    { name: "Manager2", email: "m2@example.com", password, role: "manager" },
    422,
  );
  await call(
    "procurement",
    "post",
    "/records/party",
    { name: "Customer", type: "customer" },
    422,
  );
});

test("session rotation, refresh replay revocation and logout invalidate access", async () => {
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password });
  const oldCookie = login.headers["set-cookie"][0].split(";")[0];
  assert.match(login.headers["set-cookie"][0], /HttpOnly/);
  assert.match(login.headers["set-cookie"][0], /SameSite=Strict/);
  const fresh = await request(app)
    .post("/api/auth/refresh")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", oldCookie)
    .send({});
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  await request(app)
    .get("/api/me")
    .set("Authorization", "Bearer " + fresh.body.accessToken)
    .expect(200);
  await request(app)
    .post("/api/auth/refresh")
    .set("Origin", "http://localhost:3000")
    .set("Cookie", oldCookie)
    .send({})
    .expect(401);
  await request(app)
    .get("/api/me")
    .set("Authorization", "Bearer " + fresh.body.accessToken)
    .expect(401);
  await call("seller", "post", "/auth/logout", {}, 204);
  await call("seller", "get", "/me", undefined, 401);
});

test("deactivated staff sessions are revoked immediately", async () => {
  const seller = await M.User.findOne({ role: "seller" });
  await call("admin", "patch", "/users/" + seller.id, { active: false });
  await call("seller", "get", "/me", undefined, 401);
});

test("invalid credentials are generic and repeated failures lock the account", async () => {
  for (let i = 0; i < 5; i++)
    await request(app)
      .post("/api/auth/login")
      .send({ email: "seller@example.com", password: "incorrect-password" })
      .expect(401);
  await request(app)
    .post("/api/auth/login")
    .send({ email: "seller@example.com", password })
    .expect(401);
  const u = await M.User.findOne({ role: "seller" });
  assert.ok(u.lockedUntil > Date.now());
  await request(app)
    .post("/api/auth/login")
    .send({ email: "missing@example.com", password })
    .expect(401);
});

test("pending TT cannot dispatch; duplicate verification cannot double credit", async () => {
  const { order, product, warehouse } = await createOrder(100, 10000, {
    paid: 0,
  });
  await stock(product, warehouse);
  const p = await call(
    "customer",
    "post",
    "/orders/" + order._id + "/payments",
    { amount: 5000, method: "TT", reference: "unique-transfer" },
    201,
  );
  await ship(order, warehouse, 40, {}, 422);
  await call(
    "seller",
    "post",
    "/payments/" + p._id + "/verify",
    { bankFundsConfirmed: true },
    403,
  );
  const results = await Promise.all([
    request(app)
      .post("/api/payments/" + p._id + "/verify")
      .set("Authorization", "Bearer " + tokens.admin)
      .set("Idempotency-Key", randomUUID())
      .send({ bankFundsConfirmed: true }),
    request(app)
      .post("/api/payments/" + p._id + "/verify")
      .set("Authorization", "Bearer " + tokens.admin)
      .set("Idempotency-Key", randomUUID())
      .send({ bankFundsConfirmed: true }),
  ]);
  assert.equal(
    results.filter((r) => r.status === 200).length,
    1,
    JSON.stringify(results.map((r) => r.body)),
  );
  const o = await M.Order.findById(order._id);
  assert.equal(o.paidCents, 500000);
  assert.equal(
    await M.Journal.countDocuments({ reference: "payment:" + p._id }),
    1,
  );
});

test("concurrent shipments cannot oversell stock and failed dispatch rolls back", async () => {
  const { order, product, warehouse } = await createOrder(200, 20000, {
    paid: 10000,
  });
  await stock(product, warehouse, 100, 6000);
  const payload = {
    quantity: 70,
    direct: false,
    warehouse: warehouse._id,
    driver: "Ahmad",
    vehicle: "1",
    additionalFee: 0,
    feeAccepted: false,
  };
  const results = await Promise.all([
    request(app)
      .post("/api/orders/" + order._id + "/shipments")
      .set("Authorization", "Bearer " + tokens.seller)
      .set("Idempotency-Key", randomUUID())
      .send(payload),
    request(app)
      .post("/api/orders/" + order._id + "/shipments")
      .set("Authorization", "Bearer " + tokens.seller)
      .set("Idempotency-Key", randomUUID())
      .send(payload),
  ]);
  assert.equal(
    results.filter((r) => r.status === 201).length,
    1,
    JSON.stringify(results.map((r) => r.body)),
  );
  const b = await M.Batch.findOne();
  assert.equal(b.quantity, 30);
  assert.equal(b.valueCents, 180000);
  assert.equal(await M.Shipment.countDocuments(), 1);
  assert.equal(await M.Movement.countDocuments({ kind: "Dispatch" }), 1);
  assert.equal(await M.Journal.countDocuments({ memo: "Dispatch cost" }), 1);
});

test("split fees need actual acceptance and cannot claim inclusion after acceptance", async () => {
  const { order, product, warehouse } = await createOrder(100, 10000, {
    splitIncluded: false,
  });
  await stock(product, warehouse);
  await ship(order, warehouse, 40);
  await ship(order, warehouse, 30, {}, 422);
  await ship(
    order,
    warehouse,
    30,
    { additionalFee: 100, feeAccepted: true },
    422,
  );
  await ship(order, warehouse, 30, {
    additionalFee: 100,
    feeAccepted: true,
    acceptanceEvidence: "Customer agreed by signed amendment",
  });
  const o = await M.Order.findById(order._id);
  assert.equal(o.totalCents, 1010000);
  assert.equal(o.acceptedSnapshot.totalCents, 1000000);
  await ship(order, warehouse, 30, { splitIncluded: true }, 422);
});

test("full delivery, return inspection, exact 75% refund and balanced journals", async () => {
  const { order, product, warehouse } = await createOrder();
  await stock(product, warehouse, 100, 6000);
  const sh = await ship(order, warehouse, 100);
  await call(
    "seller",
    "post",
    "/shipments/" + sh._id + "/handover",
    { recipient: "Buyer", proof: "Receipt" },
    422,
  );
  await pay(order._id, 5000);
  await call("seller", "post", "/shipments/" + sh._id + "/handover", {
    recipient: "Buyer",
    proof: "Signed receipt",
  });
  const r = await call(
    "customer",
    "post",
    "/orders/" + order._id + "/returns",
    { reason: "Inspection return" },
    201,
  );
  assert.equal(r.refundCents, 750000);
  assert.equal(r.retainedCents, 250000);
  await call(
    "admin",
    "post",
    "/returns/" + r._id + "/complete",
    {
      inspectionPassed: false,
      refundConfirmed: true,
      returnedQuantity: 100,
      warehouse: warehouse._id,
      note: "Damaged",
    },
    422,
  );
  await call("admin", "post", "/returns/" + r._id + "/complete", {
    inspectionPassed: true,
    refundConfirmed: true,
    returnedQuantity: 100,
    warehouse: warehouse._id,
    note: "Delivered condition confirmed",
  });
  const o = await M.Order.findById(order._id);
  assert.equal(o.status, "Refunded");
  assert.equal(o.refundedCents, 750000);
  assert.equal(o.receivableCents, 0);
  assert.equal(o.depositCents, 0);
  const batches = await M.Batch.find();
  assert.equal(
    batches.reduce((v, b) => v + b.quantity, 0),
    100,
  );
  assert.equal(
    batches.reduce((v, b) => v + b.valueCents, 0),
    600000,
  );
  const bs = await call("admin", "get", "/reports/balance-sheet");
  assert.equal(bs.balanced, true);
  const income = await call("admin", "get", "/reports/income-statement");
  assert.equal(income.netProfitCents, 250000);
  await call(
    "admin",
    "post",
    "/returns/" + r._id + "/complete",
    {
      inspectionPassed: true,
      refundConfirmed: true,
      returnedQuantity: 100,
      warehouse: warehouse._id,
      note: "Again",
    },
    422,
  );
});

test("partial dispatch return restores only dispatched quantity and deposit refund basis", async () => {
  const { order, product, warehouse } = await createOrder();
  await stock(product, warehouse);
  await ship(order, warehouse, 40);
  const r = await call(
    "customer",
    "post",
    "/orders/" + order._id + "/returns",
    { reason: "Cancel in transit" },
    201,
  );
  assert.equal(r.refundCents, 250000);
  await call("admin", "post", "/returns/" + r._id + "/complete", {
    inspectionPassed: true,
    refundConfirmed: true,
    returnedQuantity: 40,
    warehouse: warehouse._id,
    note: "Returned in original condition",
  });
  const batches = await M.Batch.find();
  assert.equal(
    batches.reduce((v, b) => v + b.quantity, 0),
    100,
  );
  assert.equal(
    batches.reduce((v, b) => v + b.valueCents, 0),
    600000,
  );
  const bs = await call("admin", "get", "/reports/balance-sheet");
  assert.equal(bs.balanced, true);
});

test("pre-shipping cancellation full refund and expired inspection deadline rejected", async () => {
  const { order } = await createOrder();
  const r = await call(
    "customer",
    "post",
    "/orders/" + order._id + "/returns",
    { reason: "Before dispatch" },
    201,
  );
  assert.equal(r.refundCents, 500000);
  assert.equal(r.retainedCents, 0);
  await call("admin", "post", "/returns/" + r._id + "/complete", {
    inspectionPassed: true,
    refundConfirmed: true,
    returnedQuantity: 0,
    note: "No goods left warehouse",
  });
  const second = await createOrder();
  await stock(second.product, second.warehouse);
  const sh = await ship(second.order, second.warehouse, 100);
  await pay(second.order._id, 5000);
  await call("seller", "post", "/shipments/" + sh._id + "/handover", {
    recipient: "Buyer",
    proof: "Receipt",
  });
  await M.Shipment.updateOne(
    { _id: sh._id },
    { $set: { handedOverAt: new Date(Date.now() - 25 * 3600000) } },
  );
  await call(
    "customer",
    "post",
    "/orders/" + second.order._id + "/returns",
    { reason: "Too late" },
    422,
  );
});

test("direct border trade never decrements warehouse stock", async () => {
  const { order, product, warehouse } = await createOrder();
  await stock(product, warehouse);
  await ship(order, warehouse, 40, {
    direct: true,
    sourceBorder: "Islam Qala",
    directCost: 2400,
    warehouse: undefined,
  });
  const b = await M.Batch.findOne();
  assert.equal(b.quantity, 100);
  assert.equal(await M.Movement.countDocuments({ kind: "Dispatch" }), 0);
  assert.equal(
    await M.Journal.countDocuments({ memo: "Direct trade cost" }),
    1,
  );
});

test("fractional stock allocation conserves exact cents and tonnes", async () => {
  const { order, product, warehouse } = await createOrder(0.3, 10, { paid: 5 });
  await stock(product, warehouse, 0.3, 0.01);
  await ship(order, warehouse, 0.1);
  await ship(order, warehouse, 0.2);
  const b = await M.Batch.findOne();
  assert.equal(b.quantity, 0);
  assert.equal(b.valueCents, 0);
  const sh = await M.Shipment.find();
  assert.equal(
    sh.reduce((v, x) => v + x.costCents, 0),
    1,
  );
});

test("supplier payments and payroll have duplicate protection and balanced ledger", async () => {
  const { product, warehouse } = await createOrder();
  const { p } = await stock(product, warehouse);
  await call(
    "admin",
    "post",
    "/purchases/" + p._id + "/pay",
    { amount: 3000, reference: "SUP-1" },
    201,
  );
  await call(
    "admin",
    "post",
    "/purchases/" + p._id + "/pay",
    { amount: 3000, reference: "SUP-1" },
    409,
  );
  await call(
    "admin",
    "post",
    "/purchases/" + p._id + "/pay",
    { amount: 4000, reference: "SUP-2" },
    422,
  );
  const employee = await call(
    "admin",
    "post",
    "/records/employee",
    { name: "Ahmad", job: "Sales", salary: 500 },
    201,
  );
  await call("admin", "post", "/employees/" + employee._id + "/advance", {
    amount: 100,
  });
  await call(
    "admin",
    "post",
    "/employees/" + employee._id + "/salary",
    { month: "2026-10", deduction: 100 },
    201,
  );
  await call(
    "admin",
    "post",
    "/employees/" + employee._id + "/salary",
    { month: "2026-10", deduction: 0 },
    409,
  );
  const e = await M.Employee.findById(employee._id);
  assert.equal(e.advanceCents, 0);
  const bs = await call("admin", "get", "/reports/balance-sheet");
  assert.equal(bs.balanced, true);
});

test("cursor pagination is bounded and stable", async () => {
  for (let i = 0; i < 6; i++)
    await M.Product.create({ name: { en: "Product " + i } });
  const first = await call("admin", "get", "/records/product?limit=2");
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await call(
    "admin",
    "get",
    "/records/product?limit=2&cursor=" + first.nextCursor,
  );
  assert.equal(second.items.length, 2);
  assert.ok(
    !first.items.some((x) => second.items.some((y) => y._id === x._id)),
  );
});

test("manual journals validate accounts; posted entries are append-only and reversal is unique", async () => {
  const body = {
    memo: "Opening capital",
    lines: [
      { account: "Bank", debitCents: 10000, creditCents: 0 },
      { account: "Owner capital", debitCents: 0, creditCents: 10000 },
    ],
  };
  const j = await call("admin", "post", "/journals", body, 201);
  await call(
    "admin",
    "post",
    "/journals",
    {
      ...body,
      lines: [
        { account: "Unknown", debitCents: 10000, creditCents: 0 },
        { account: "Owner capital", debitCents: 0, creditCents: 10000 },
      ],
    },
    422,
  );
  await call("admin", "post", "/journals/" + j._id + "/reverse", {});
  await call("admin", "post", "/journals/" + j._id + "/reverse", {}, 409);
  assert.equal(await M.Journal.countDocuments(), 2);
  await assert.rejects(() =>
    M.Journal.updateOne({ _id: j._id }, { $set: { memo: "Tampered" } }),
  );
  await assert.rejects(() => M.Audit.deleteMany({}));
  const bs = await call("admin", "get", "/reports/balance-sheet");
  assert.equal(bs.balanced, true);
});

test("document quarantine, safe types, scanning and customer ownership", async () => {
  const { order } = await createOrder();
  const content = Buffer.from("%PDF-1.4\nexample test document");
  const uploaded = await request(app)
    .post("/api/orders/" + order._id + "/documents")
    .set("Authorization", "Bearer " + tokens.customer)
    .set("Content-Type", "application/pdf")
    .set("X-Document-Name", "receipt.pdf")
    .send(content);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  const key = uploaded.body.id;
  await call("customer", "get", "/documents/" + key, undefined, 422);
  await call("seller", "post", "/documents/" + key + "/scan", {}, 403);
  await call("admin", "post", "/documents/" + key + "/scan", {});
  const downloaded = await request(app)
    .get("/api/documents/" + key)
    .set("Authorization", "Bearer " + tokens.customer);
  assert.equal(downloaded.status, 200);
  assert.match(downloaded.headers["content-disposition"], /attachment/);
  await call("other", "get", "/documents/" + key, undefined, 404);
  await request(app)
    .post("/api/orders/" + order._id + "/documents")
    .set("Authorization", "Bearer " + tokens.customer)
    .set("Content-Type", "application/pdf")
    .set("X-Document-Name", "fake.pdf")
    .send(Buffer.from("<script>bad</script>"))
    .expect(422);
  await request(app)
    .post("/api/orders/" + order._id + "/documents")
    .set("Authorization", "Bearer " + tokens.customer)
    .set("Content-Type", "application/pdf")
    .set("X-Document-Name", "../bad.pdf")
    .send(content)
    .expect(422);
});

test("financial retry returns the same result and rejects a changed request", async () => {
  const employee = await call(
    "admin",
    "post",
    "/records/employee",
    { name: "Employee", salary: 500 },
    201,
  );
  const key = randomUUID();
  const send = (amount) =>
    request(app)
      .post("/api/employees/" + employee._id + "/advance")
      .set("Authorization", "Bearer " + tokens.admin)
      .set("Idempotency-Key", key)
      .send({ amount });
  const [a, b] = await Promise.all([send(100), send(100)]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const e = await M.Employee.findById(employee._id);
  assert.equal(e.advanceCents, 10000);
  assert.equal(await M.Journal.countDocuments(), 1);
  await send(150).expect(409);
  await request(app)
    .post("/api/employees/" + employee._id + "/advance")
    .set("Authorization", "Bearer " + tokens.admin)
    .send({ amount: 1 })
    .expect(400);
});

test("stock transfers preserve cost and reject overdraw", async () => {
  const { product, warehouse } = await createOrder();
  const { b } = await stock(product, warehouse, 100, 6000);
  const target = await call(
    "admin",
    "post",
    "/records/warehouse",
    { name: "Herat" },
    201,
  );
  await call("procurement", "post", "/stock/transfer", {
    batch: b._id,
    warehouse: target._id,
    quantity: 40,
  });
  await call(
    "procurement",
    "post",
    "/stock/transfer",
    { batch: b._id, warehouse: target._id, quantity: 70 },
    422,
  );
  const batches = await M.Batch.find();
  assert.equal(
    batches.reduce((v, b) => v + b.quantity, 0),
    100,
  );
  assert.equal(
    batches.reduce((v, b) => v + b.valueCents, 0),
    600000,
  );
  assert.equal(await M.Movement.countDocuments({ kind: "TransferOut" }), 1);
});

test("concurrent verified payments cannot exceed the order balance", async () => {
  const { order } = await createOrder(100, 10000, { paid: 0 });
  const a = await call(
      "customer",
      "post",
      "/orders/" + order._id + "/payments",
      { amount: 6000, method: "TT", reference: "A" },
      201,
    ),
    b = await call(
      "customer",
      "post",
      "/orders/" + order._id + "/payments",
      { amount: 6000, method: "TT", reference: "B" },
      201,
    );
  const results = await Promise.all(
    [a, b].map((p) =>
      request(app)
        .post("/api/payments/" + p._id + "/verify")
        .set("Authorization", "Bearer " + tokens.admin)
        .set("Idempotency-Key", randomUUID())
        .send({ bankFundsConfirmed: true }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const o = await M.Order.findById(order._id);
  assert.equal(o.paidCents, 600000);
  assert.equal(await M.Payment.countDocuments({ status: "Verified" }), 1);
});

test("expired access sessions and forged tokens are rejected", async () => {
  await request(app)
    .get("/api/me")
    .set("Authorization", "Bearer fake.fake.fake")
    .expect(401);
  const u = await M.User.findOne({ role: "customer" });
  await M.Session.updateMany(
    { user: u.id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  await call("customer", "get", "/orders", undefined, 401);
});

test("proforma revisions require reacceptance and preserve previous terms", async () => {
  const { order, product } = await createOrder(100, 10000, { paid: 0 });
  await call("seller", "post", "/orders/" + order._id + "/revise", {
    productTotal: 11000,
    deliveryFees: 100,
    border: "Torkham",
    splitIncluded: false,
    reason: "Customer requested destination change",
  });
  const o = await M.Order.findById(order._id);
  assert.equal(o.version, 2);
  assert.equal(o.acceptedAt, undefined);
  assert.equal(o.proformaHistory[0].totalCents, 1000000);
  await call(
    "customer",
    "post",
    "/orders/" + o.id + "/payments",
    { amount: 5500, method: "TT", reference: "Before acceptance" },
    422,
  );
  await call("admin", "patch", "/records/product/" + product._id, {
    name: { en: "Changed catalog name" },
  });
  const invoice = await call(
    "customer",
    "get",
    "/orders/" + o.id + "/proforma",
  );
  assert.equal(invoice.product.name.en, "Beans");
  await call("customer", "post", "/orders/" + o.id + "/accept", {});
  await pay(o.id, 5500);
  await call(
    "seller",
    "post",
    "/orders/" + o.id + "/revise",
    {
      productTotal: 12000,
      deliveryFees: 100,
      border: "Torkham",
      reason: "Too late",
    },
    422,
  );
});

test("return rejection preserves the original order state with audit", async () => {
  const { order } = await createOrder();
  const r = await call(
    "customer",
    "post",
    "/orders/" + order._id + "/returns",
    { reason: "Request" },
    201,
  );
  await call("admin", "post", "/returns/" + r._id + "/reject", {
    reason: "Customer withdrew request",
  });
  const o = await M.Order.findById(order._id);
  assert.equal(o.status, "Ready to ship");
  const ret = await M.Return.findById(r._id);
  assert.equal(ret.status, "Rejected");
  assert.equal(await M.Audit.countDocuments({ action: "return.reject" }), 1);
});

test("authentication rate limit is enforced through the shared MongoDB store", async () => {
  for (let i = 0; i < 14; i++)
    await request(app)
      .post("/api/auth/login")
      .send({ email: "unknown@example.com", password: "incorrect-password" })
      .expect(401);
  const response = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password });
  assert.equal(response.status, 429);
  assert.ok(response.headers["ratelimit"]);
  assert.ok(
    await mongoose.connection
      .collection("rate_limits")
      .findOne({ _id: { $regex: "^auth:" } }),
  );
});

test("customer shipment responses hide supplier costs and FIFO allocation details", async () => {
  const { order, product, warehouse } = await createOrder();
  await stock(product, warehouse);
  await ship(order, warehouse, 40);
  const buyer = await call("customer", "get", "/orders/" + order._id),
    staff = await call("seller", "get", "/orders/" + order._id);
  assert.equal(buyer.shipments[0].costCents, undefined);
  assert.equal(buyer.shipments[0].allocations, undefined);
  assert.equal(staff.shipments[0].costCents, 240000);
});

test("email verification consumes an expiring link and blocks unverified login", async () => {
  await request(app)
    .post("/api/auth/register")
    .send({ name: "New customer", email: "new@example.com", password })
    .expect(201);
  await request(app)
    .post("/api/auth/login")
    .send({ email: "new@example.com", password })
    .expect(422);
  const job = await M.EmailJob.findOne({ state: "Queued" });
  const { decrypt } = await import("../src/shared/encryption.js");
  const body = JSON.parse(decrypt(job.payload, config.encryptionKey));
  assert.ok(!job.payload.includes("token="));
  const token = new URL(body.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
    "token",
  );
  await request(app).post("/api/auth/verify-email").send({ token }).expect(200);
  await request(app).post("/api/auth/verify-email").send({ token }).expect(422);
  await request(app)
    .post("/api/auth/login")
    .send({ email: "new@example.com", password })
    .expect(200);
});

test("password reset is one-use, expires, preserves MFA and revokes sessions", async () => {
  const first = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "customer@example.com" }),
    missing = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, missing.body);
  const job = await M.EmailJob.findOne();
  const { decrypt } = await import("../src/shared/encryption.js");
  const payload = JSON.parse(decrypt(job.payload, config.encryptionKey)),
    token = new URL(payload.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
      "token",
    );
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token, password: "New-Secure-Password-43!" })
    .expect(200);
  await call("customer", "get", "/orders", undefined, 401);
  await request(app)
    .post("/api/auth/reset-password")
    .send({ token, password: "New-Secure-Password-44!" })
    .expect(422);
  await request(app)
    .post("/api/auth/login")
    .send({
      email: "customer@example.com",
      password: "New-Secure-Password-43!",
    })
    .expect(200);
});

test("MFA enrollment revokes sessions, recovery codes are one-use, and codes are encrypted", async () => {
  const enrolled = await call("admin", "post", "/auth/mfa/enroll", {
    password,
  });
  const { totp } = await import("../src/modules/auth/mfa.service.js");
  const confirmed = await call("admin", "post", "/auth/mfa/confirm", {
    code: totp(enrolled.secret, "admin@example.com").generate(),
  });
  assert.equal(confirmed.recoveryCodes.length, 10);
  await call("admin", "get", "/me", undefined, 401);
  const user = await M.User.findOne({ role: "admin" });
  assert.ok(!user.mfaSecret.includes(enrolled.secret));
  await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password })
    .expect(422);
  await request(app)
    .post("/api/auth/login")
    .send({
      email: "admin@example.com",
      password,
      mfaCode: confirmed.recoveryCodes[0],
    })
    .expect(200);
  await request(app)
    .post("/api/auth/login")
    .send({
      email: "admin@example.com",
      password,
      mfaCode: confirmed.recoveryCodes[0],
    })
    .expect(422);
});

test("bank reconciliation checks exact cash movement, unique matches and closing", async () => {
  const j = await call(
    "admin",
    "post",
    "/journals",
    {
      memo: "Capital",
      lines: [
        { account: "Bank", debitCents: 10000, creditCents: 0 },
        { account: "Owner capital", debitCents: 0, creditCents: 10000 },
      ],
    },
    201,
  );
  const statementDate = new Date(j.createdAt).toISOString().slice(0, 10);
  const statement = await call(
    "admin",
    "post",
    "/reconciliation/statements",
    {
      name: "October",
      account: "Bank",
      openingCents: 0,
      closingCents: 10000,
      csv: `date,reference,amount\n${statementDate},BANK-1,100.00`,
    },
    201,
  );
  const read = await call(
    "admin",
    "get",
    "/reconciliation/statements/" + statement._id,
  );
  await call(
    "admin",
    "post",
    "/reconciliation/statements/" + statement._id + "/close",
    {},
    422,
  );
  await call(
    "admin",
    "post",
    "/reconciliation/lines/" + read.items[0]._id + "/match",
    { journal: j._id },
  );
  await call(
    "admin",
    "post",
    "/reconciliation/statements/" + statement._id + "/close",
    {},
  );
  const s = await M.BankStatement.findById(statement._id);
  assert.equal(s.status, "Closed");
  await call(
    "admin",
    "post",
    "/reconciliation/statements",
    {
      name: "Duplicate",
      account: "Bank",
      openingCents: 0,
      closingCents: 10000,
      csv: `date,reference,amount\n${statementDate},BANK-1,100.00`,
    },
    409,
  );
});

test("custom accounts participate in expenses and income statements", async () => {
  await call(
    "admin",
    "post",
    "/accounting/accounts",
    { code: "5400", name: "Storage expense", type: "expense" },
    201,
  );
  await call(
    "admin",
    "post",
    "/accounting/expenses",
    {
      amount: 100,
      category: "Storage expense",
      memo: "Warehouse storage",
      reference: "EXP-1",
    },
    201,
  );
  const report = await call("admin", "get", "/reports/income-statement");
  assert.equal(report.expenseCents, 10000);
  const bs = await call("admin", "get", "/reports/balance-sheet");
  assert.equal(bs.balanced, true);
});

test("generated commercial PDF is protected and notifications are private", async () => {
  const { order } = await createOrder();
  const pdf = await request(app)
    .get("/api/orders/" + order._id + "/documents/proforma.pdf")
    .set("Authorization", "Bearer " + tokens.customer);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
  await call(
    "other",
    "get",
    "/orders/" + order._id + "/documents/proforma.pdf",
    undefined,
    404,
  );
  const ns = await call("customer", "get", "/notifications");
  assert.ok(ns.items.length > 0);
  await call(
    "other",
    "post",
    "/notifications/" + ns.items[0]._id + "/read",
    {},
    404,
  );
});

test("USD checkout verifies signatures, currency, amounts and duplicate webhooks", async () => {
  const { order } = await createOrder(100, 10000, { paid: 0 });
  config.gateway = {
    create: async (a) => ({
      id: "cs_test_" + a.id,
      url: "https://checkout.example/" + a.id,
    }),
    verify: (buffer, sig) => {
      if (sig !== "valid") throw Error("bad signature");
      return JSON.parse(buffer.toString());
    },
  };
  const checkout = await call(
    "customer",
    "post",
    "/orders/" + order._id + "/checkout",
    { amount: 5000 },
  );
  const attempt = await M.CheckoutAttempt.findById(checkout.attempt);
  const event = {
    id: "evt_test",
    type: "checkout.session.completed",
    data: {
      object: {
        id: attempt.providerSession,
        payment_status: "paid",
        currency: "usd",
        amount_total: 500000,
        payment_intent: "pi_test",
        metadata: { attempt: attempt.id },
      },
    },
  };
  await request(app)
    .post("/api/webhooks/stripe")
    .set("stripe-signature", "invalid")
    .send(event)
    .expect(400);
  await request(app)
    .post("/api/webhooks/stripe")
    .set("stripe-signature", "valid")
    .send(event)
    .expect(200);
  await request(app)
    .post("/api/webhooks/stripe")
    .set("stripe-signature", "valid")
    .send(event)
    .expect(200);
  const o = await M.Order.findById(order._id);
  assert.equal(o.paidCents, 500000);
  assert.equal(await M.Payment.countDocuments({ method: "VISA" }), 1);
  config.gateway = undefined;
});

test("expired email links, resend cooldown and email-worker retries fail safely", async () => {
  await request(app)
    .post("/api/auth/register")
    .send({ name: "Mail customer", email: "mail@example.com", password })
    .expect(201);
  await request(app)
    .post("/api/auth/resend-verification")
    .send({ email: "mail@example.com" })
    .expect(200);
  assert.equal(await M.EmailJob.countDocuments(), 1);
  const tokenRow = await M.EmailToken.findOne();
  await M.EmailToken.updateOne(
    { _id: tokenRow.id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  const { decrypt } = await import("../src/shared/encryption.js");
  const job = await M.EmailJob.findOne(),
    payload = JSON.parse(decrypt(job.payload, config.encryptionKey)),
    token = new URL(payload.text.match(/https?:\/\/\S+/)[0]).searchParams.get(
      "token",
    );
  await request(app).post("/api/auth/verify-email").send({ token }).expect(422);
  const { deliverOne } = await import("../src/modules/email/email.service.js");
  config.mailer = {
    send: async () => {
      throw Error("offline");
    },
  };
  await deliverOne(config);
  const failed = await M.EmailJob.findById(job.id);
  assert.equal(failed.state, "Queued");
  assert.equal(failed.lastError, "Delivery failed");
  await M.EmailJob.updateOne(
    { _id: job.id },
    { $set: { availableAt: new Date() } },
  );
  const delivered = [];
  config.mailer = { send: async (p) => delivered.push(p) };
  await deliverOne(config);
  assert.equal(delivered.length, 1);
  assert.equal((await M.EmailJob.findById(job.id)).state, "Sent");
  config.mailer = undefined;
});

test("MFA is optional for all roles including privileged staff", async () => {
  config.requireStaffMfa = true;
  try {
    await call("admin", "get", "/records/journal");
    await call("admin", "get", "/me");
    await call("admin", "post", "/auth/mfa/enroll", { password });
  } finally {
    config.requireStaffMfa = false;
  }
});

test("an infected upload cannot be marked clean by a caller", async () => {
  const { order } = await createOrder();
  const content = Buffer.from("%PDF-1.4\nEICAR test placeholder"),
    uploaded = await request(app)
      .post("/api/orders/" + order._id + "/documents")
      .set("Authorization", "Bearer " + tokens.customer)
      .set("Content-Type", "application/pdf")
      .set("X-Document-Name", "sample.pdf")
      .send(content);
  assert.equal(uploaded.status, 201);
  config.scanner = async () => ({ clean: false, engine: "test-virus" });
  try {
    await call("admin", "post", "/documents/" + uploaded.body.id + "/scan", {});
    await call(
      "customer",
      "get",
      "/documents/" + uploaded.body.id,
      undefined,
      422,
    );
    assert.equal(
      (await M.Document.findById(uploaded.body.id)).status,
      "Rejected",
    );
  } finally {
    config.scanner = async () => ({ clean: true, engine: "test" });
  }
});

test("card refund is provider-confirmed, retry-safe and bounded by the return refund", async () => {
  const { order } = await createOrder(100, 10000, { paid: 0 });
  config.gateway = {
    create: async (a) => ({
      id: "cs_ref_" + a.id,
      url: "https://checkout.example/" + a.id,
    }),
    verify: (b) => JSON.parse(b.toString()),
    refund: async () => ({ id: "re_test", status: "succeeded" }),
  };
  try {
    const checkout = await call(
        "customer",
        "post",
        "/orders/" + order._id + "/checkout",
        { amount: 10000 },
      ),
      attempt = await M.CheckoutAttempt.findById(checkout.attempt);
    await request(app)
      .post("/api/webhooks/stripe")
      .send({
        id: "evt_ref",
        type: "checkout.session.completed",
        data: {
          object: {
            id: attempt.providerSession,
            payment_status: "paid",
            currency: "usd",
            amount_total: 1000000,
            payment_intent: "pi_ref",
            metadata: { attempt: attempt.id },
          },
        },
      })
      .expect(200);
    const payment = await M.Payment.findOne({ order: order._id }),
      r = await call(
        "customer",
        "post",
        "/orders/" + order._id + "/returns",
        { reason: "Cancel before shipping" },
        201,
      );
    const key = randomUUID(),
      run = () =>
        request(app)
          .post("/api/returns/" + r._id + "/card-refunds")
          .set("Authorization", "Bearer " + tokens.admin)
          .set("Idempotency-Key", key)
          .send({ payment: payment.id, amount: 10000, inspectionPassed: true });
    await run().expect(200);
    await run().expect(200);
    assert.equal(await M.CardRefund.countDocuments(), 1);
    await call(
      "admin",
      "post",
      "/returns/" + r._id + "/card-refunds",
      { payment: payment.id, amount: 1, inspectionPassed: true },
      422,
    );
  } finally {
    config.gateway = undefined;
  }
});

test("fiscal-year close requires all months and preserves reported historical profit", async () => {
  await M.Journal.create({
    memo: "Historical sale",
    reference: "historical:2025",
    createdAt: new Date("2025-10-01"),
    lines: [
      { account: "Bank", debitCents: 10000, creditCents: 0 },
      { account: "Sales revenue", debitCents: 0, creditCents: 10000 },
    ],
  });
  await call("admin", "post", "/accounting/fiscal-close", { year: 2025 }, 422);
  await M.AccountingPeriod.insertMany(
    Array.from({ length: 12 }, (_, i) => ({
      month: "2025-" + String(i + 1).padStart(2, "0"),
      closedAt: new Date(),
      closedBy: new mongoose.Types.ObjectId(),
    })),
  );
  await call("admin", "post", "/accounting/fiscal-close", { year: 2025 }, 201);
  const income = await call(
    "admin",
    "get",
    "/reports/income-statement?from=2025-01-01&to=2025-12-31",
  );
  assert.equal(income.netProfitCents, 10000);
  const balance = await call(
    "admin",
    "get",
    "/reports/balance-sheet?to=2025-12-31",
  );
  assert.equal(balance.balanced, true);
  assert.equal(balance.currentEarningsCents, 0);
  await call("admin", "post", "/accounting/fiscal-close", { year: 2025 }, 422);
});

test("automatic scanner worker clears quarantine only after scanning stored bytes", async () => {
  const { order } = await createOrder();
  const upload = await request(app)
    .post("/api/orders/" + order._id + "/documents")
    .set("Authorization", "Bearer " + tokens.customer)
    .set("Content-Type", "application/pdf")
    .set("X-Document-Name", "auto.pdf")
    .send(Buffer.from("%PDF-1.4\nautomatic scan"));
  const { scanOne } =
    await import("../src/modules/documents/scanner.worker.js");
  await scanOne(config);
  assert.equal((await M.Document.findById(upload.body.id)).status, "Clean");
  const n = await call("customer", "get", "/notifications");
  await call(
    "customer",
    "post",
    "/notifications/" + n.items[0]._id + "/read",
    {},
  );
  assert.ok((await M.Notification.findById(n.items[0]._id)).readAt);
});

test("changing a password requires the old password and revokes existing sessions", async () => {
  await call(
    "customer",
    "post",
    "/auth/change-password",
    {
      oldPassword: "Wrong-Password-Here",
      newPassword: "New-Changed-Password-85",
    },
    422,
  );
  await call("customer", "post", "/auth/change-password", {
    oldPassword: password,
    newPassword: "New-Changed-Password-85",
  });
  await call("customer", "get", "/orders", undefined, 401);
  await request(app)
    .post("/api/auth/login")
    .send({
      email: "customer@example.com",
      password: "New-Changed-Password-85",
    })
    .expect(200);
});

test("production transport gate rejects HTTP and untrusted forwarded protocol", async () => {
  const secured = await createApp({
    ...config,
    mode: "production",
    scryptN: 16384,
    trustProxy: false,
    requireStaffMfa: true,
  });
  await request(secured)
    .post("/api/auth/login")
    .send({ email: "admin@example.com", password })
    .expect(426);
  await request(secured)
    .post("/api/auth/login")
    .set("X-Forwarded-Proto", "https")
    .send({ email: "admin@example.com", password })
    .expect(426);
  await request(secured).get("/api/health/live").expect(200);
});
