import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { seedDemo } from "../src/database/seed.service.js";
import { deliverOne } from "../src/modules/email/email.service.js";
import * as M from "../src/models.js";
let repl, app, config, ids, png;
const tokens = {};
const password = "Upgrade-Integration-Password-98!";
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  await mongoose.connect(repl.getUri());
  for (const m of Object.values(M)) await m.init();
  config = readConfig({
    NODE_ENV: "test",
    MONGODB_URI: repl.getUri(),
    JWT_SECRET: "u".repeat(64),
    DOCUMENT_UPLOADS_ENABLED: "false",
    NOTIFICATION_WORKER_KEY: "w".repeat(40),
  });
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
      .send({ email: role + "@demo.test", password })
      .expect(200);
    tokens[role] = r.body.accessToken;
  }
  png = await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#eeeeee" },
  })
    .png()
    .toBuffer();
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
const call = (role, method, path, body, key = randomUUID()) => {
  const q = request(app)
    [method]("/api" + path)
    .set("Authorization", "Bearer " + tokens[role])
    .set("Idempotency-Key", key);
  return body === undefined ? q : q.send(body);
};
async function receipt(order) {
  const r = await request(app)
    .post(`/api/orders/${order}/receipts`)
    .set("Authorization", "Bearer " + tokens.customer)
    .set("Content-Type", "image/png")
    .send(png)
    .expect(201);
  return r.body.id;
}
async function pay(o, amount) {
  const p = await call("customer", "post", `/orders/${o}/payments`, {
    amount,
    method: "TT",
    reference: randomUUID(),
    receiptKey: await receipt(o),
  }).expect(201);
  await call("manager", "post", `/payments/${p.body._id}/verify`, {
    bankFundsConfirmed: true,
  }).expect(200);
}
async function quote(product, quantity, total, items) {
  const i = await call("customer", "post", "/inquiries", {
    product,
    quantity,
  }).expect(201);
  const o = await call("seller", "post", `/inquiries/${i.body._id}/proforma`, {
    productTotal: total,
    border: "Hairatan",
    splitIncluded: true,
    ...(items ? { items } : {}),
  }).expect(201);
  await call("customer", "post", `/orders/${o.body._id}/accept`, {}).expect(
    200,
  );
  return o.body;
}
test("accepted shortage -> linked purchase -> reservations -> split handover -> warehouse return and exact refund", async () => {
  const p = await M.Product.create({
      name: { en: "Pens" },
      unit: "piece",
      moq: 1,
    }),
    k = await M.Warehouse.create({ name: "Kabul upgrade" }),
    g = await M.Warehouse.create({ name: "Ghazni upgrade" });
  await M.Batch.create([
    {
      product: p.id,
      warehouse: k.id,
      code: "K",
      quantity: 10,
      unitCostCents: 100,
      valueCents: 1000,
    },
    {
      product: p.id,
      warehouse: g.id,
      code: "G",
      quantity: 20,
      unitCostCents: 100,
      valueCents: 2000,
    },
  ]);
  const o = await quote(p.id, 40, 1000);
  let summary = await call(
    "seller",
    "get",
    `/stock/summary?product=${p.id}`,
  ).expect(200);
  assert.equal(summary.body.items[0].quantity, 30);
  assert.equal(summary.body.items[0].available, 0);
  assert.equal(summary.body.items[0].locations.length, 2);
  const demand = await call(
    "seller",
    "post",
    `/orders/${o._id}/procurement-requests`,
    {},
  ).expect(201);
  assert.equal(demand.body.quantity, 10);
  await call(
    "seller",
    "post",
    `/orders/${o._id}/procurement-requests`,
    {},
  ).expect(422);
  const supplier = await M.Party.findOne({ type: "supplier" });
  const purchase = await call("procurement", "post", "/purchases", {
    supplier: supplier.id,
    product: p.id,
    quantity: 10,
    totalCost: 10,
    request: demand.body._id,
  }).expect(201);
  const received = await call(
    "procurement",
    "post",
    `/purchases/${purchase.body._id}/receive`,
    { warehouse: g.id, batchCode: "P", location: "Shelf A2" },
  ).expect(200);
  assert.equal(received.body.location, "Shelf A2");
  assert.equal(
    (await M.ProcurementRequest.findById(demand.body._id)).status,
    "Received",
  );
  await call("procurement", "post", "/stock/transfer", {
    batch: received.body._id,
    warehouse: k.id,
    quantity: 1,
  }).expect(422);
  const detail = await call("customer", "get", `/orders/${o._id}`).expect(200);
  assert.deepEqual(detail.body.reservations, []);
  assert.deepEqual(detail.body.purchases, []);
  assert.deepEqual(detail.body.procurementRequests, []);
  await call("customer", "post", `/orders/${o._id}/payments`, {
    amount: 500,
    method: "TT",
    reference: randomUUID(),
  }).expect(422);
  await pay(o._id, 1000);
  for (const [warehouse, quantity] of [
    [k.id, 10],
    [g.id, 30],
  ]) {
    const sh = await call("seller", "post", `/orders/${o._id}/shipments`, {
      warehouse,
      quantity,
      driver: "Driver",
      vehicle: "TRUCK",
    }).expect(201);
    await call("seller", "post", `/shipments/${sh.body._id}/handover`, {
      recipient: "Customer",
      proof: "Signed receipt",
    }).expect(200);
  }
  assert.equal((await M.Order.findById(o._id)).status, "Delivered");
  const ret = await call("customer", "post", `/orders/${o._id}/returns`, {
    reason: "Within agreed inspection period",
  }).expect(201);
  assert.equal(ret.body.refundCents, 75000);
  const key = randomUUID(),
    body = {
      inspectionPassed: true,
      refundConfirmed: true,
      returnedQuantity: 40,
      warehouse: k.id,
      note: "No new damage or rust",
      refundReference: "BANK-REFUND-1",
    };
  const complete = await call(
    "manager",
    "post",
    `/returns/${ret.body._id}/complete`,
    body,
    key,
  ).expect(200);
  await call(
    "manager",
    "post",
    `/returns/${ret.body._id}/complete`,
    body,
    key,
  ).expect(200);
  assert.equal(complete.body.warehouse, k.id);
  assert.equal(complete.body.receivedBatches.length, 2);
  const moves = await M.Movement.find({ reference: ret.body._id });
  assert.equal(moves.length, 2);
  assert.ok(moves.every((m) => m.batch));
  summary = await call(
    "seller",
    "get",
    `/stock/summary?product=${p.id}`,
  ).expect(200);
  assert.equal(summary.body.items[0].quantity, 40);
  assert.equal(summary.body.items[0].available, 40);
  const hist = await call("manager", "get", `/orders/${o._id}`).expect(200);
  assert.ok(hist.body.history.some((h) => h.action === "payment.verify"));
  assert.ok(hist.body.history.some((h) => h.action === "return.complete"));
});
test("multiple product lines reserve and dispatch independently and settle full order value", async () => {
  const wh = await M.Warehouse.create({ name: "Multi line" }),
    p = await M.Product.create({ name: { en: "Pencils" }, unit: "piece" }),
    q = await M.Product.create({ name: { en: "Books" }, unit: "piece" });
  await M.Batch.create([
    {
      product: p.id,
      warehouse: wh.id,
      code: "P",
      quantity: 5,
      unitCostCents: 100,
      valueCents: 500,
    },
    {
      product: q.id,
      warehouse: wh.id,
      code: "B",
      quantity: 2,
      unitCostCents: 200,
      valueCents: 400,
    },
  ]);
  const o = await quote(p.id, 5, 300, [
    { product: p.id, quantity: 5, productTotal: 100 },
    { product: q.id, quantity: 2, productTotal: 200 },
  ]);
  await pay(o._id, 300);
  await call("seller", "post", `/orders/${o._id}/shipments`, {
    quantity: 5,
    warehouse: wh.id,
    driver: "D",
    vehicle: "V",
  }).expect(422);
  for (const i of o.items) {
    const sh = await call("seller", "post", `/orders/${o._id}/shipments`, {
      item: i._id,
      quantity: i.quantity,
      warehouse: wh.id,
      driver: "D",
      vehicle: "V",
    }).expect(201);
    await call("seller", "post", `/shipments/${sh.body._id}/handover`, {
      recipient: "C",
      proof: "Signed",
    }).expect(200);
  }
  const done = await M.Order.findById(o._id);
  assert.equal(done.status, "Delivered");
  assert.equal(done.revenueCents, 30000);
  assert.equal(
    await M.StockReservation.countDocuments({ order: o._id, status: "Active" }),
    0,
  );
});
test("video chunk upload supports range playback, permissions and inactive product isolation", async () => {
  const p = await M.Product.create({ name: { en: "Video product" } });
  await call("customer", "post", `/products/${p.id}/video`, {
    size: 20,
    mime: "video/mp4",
  }).expect(403);
  const bytes = Buffer.alloc(1024 * 1024 + 50, 1);
  bytes.write("ftyp", 4);
  const start = await call("admin", "post", `/products/${p.id}/video`, {
    size: bytes.length,
    mime: "video/mp4",
  }).expect(201);
  for (let i = 0; i < 2; i++) {
    const b = bytes.subarray(i * 1024 * 1024, (i + 1) * 1024 * 1024);
    for (let retry = 0; retry < 2; retry++)
      await request(app)
        .post(`/api/products/${p.id}/video/${start.body.id}/chunks`)
        .set("Authorization", "Bearer " + tokens.admin)
        .set("Content-Type", "video/mp4")
        .set("X-Video-Chunk", String(i))
        .send(b)
        .expect(200);
  }
  await call(
    "admin",
    "post",
    `/products/${p.id}/video/${start.body.id}/complete`,
    {},
  ).expect(200);
  const range = await request(app)
    .get(`/api/catalog/${p.id}/video`)
    .set("Range", "bytes=1048570-1048580")
    .buffer(true)
    .parse((res, cb) => {
      let a = [];
      res.on("data", (d) => a.push(d));
      res.on("end", () => cb(null, Buffer.concat(a)));
    })
    .expect(206);
  assert.deepEqual(range.body, bytes.subarray(1048570, 1048581));
  await M.Product.updateOne({ _id: p.id }, { $set: { active: false } });
  await request(app).get(`/api/catalog/${p.id}/video`).expect(404);
  await call("admin", "post", `/products/${p.id}/video/remove`, {}).expect(200);
  assert.equal(
    await M.ProductVideoChunk.countDocuments({ video: start.body.id }),
    0,
  );
});
test("queued email, notification search and delivery visibility preserve role boundaries", async () => {
  const rows = await call(
    "customer",
    "get",
    "/notifications?search=Quotation",
  ).expect(200);
  assert.ok(rows.body.items.length);
  assert.ok(rows.body.items.every((n) => n.title.includes("Quotation")));
  assert.ok(
    await M.EmailJob.countDocuments({ notification: { $exists: true } }),
  );
  await request(app).post("/api/jobs/notifications").send({}).expect(401);
  const sent = [];
  config.mailer = { send: async (p) => sent.push(p) };
  await deliverOne(config);
  assert.ok(sent.length);
  assert.match(sent[0].html, /Open dashboard/);
  assert.ok(await M.EmailJob.exists({ state: "Sent" }));
  await call("customer", "get", "/notification-delivery").expect(403);
  await call("admin", "get", "/notification-delivery").expect(200);
  await call("seller", "get", "/orders?search=%5B.*").expect(200);
  await call("customer", "get", "/procurement-requests").expect(403);
});
test("snapshot backup restores into an isolated database and rejects a modified archive", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const run = promisify(execFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), "trading-restore-"));
  const file = path.join(dir, "test.jsonl.gz");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    MONGODB_URI: repl.getUri(),
    JWT_SECRET: "u".repeat(64),
    DOCUMENT_UPLOADS_ENABLED: "false",
    RESTORE_DATABASE: "trading_restore_upgrade_test",
  };
  try {
    await run(process.execPath, ["scripts/backup.js", file], { env });
    const result = await run(
      process.execPath,
      ["scripts/restore-check.js", file],
      { env },
    );
    assert.equal(JSON.parse(result.stdout).verified, true);
    const restored = mongoose.connection.client.db(env.RESTORE_DATABASE);
    assert.equal(
      await restored.collection("orders").countDocuments(),
      await M.Order.countDocuments(),
    );
    assert.equal(
      await restored.collection("documents").countDocuments(),
      await M.Document.countDocuments(),
    );
    const data = await readFile(file);
    data[20] ^= 1;
    await writeFile(file, data);
    await assert.rejects(
      run(process.execPath, ["scripts/restore-check.js", file], { env }),
      /checksum mismatch/,
    );
  } finally {
    await mongoose.connection.client.db(env.RESTORE_DATABASE).dropDatabase();
    await rm(dir, { recursive: true, force: true });
  }
});
test("dry-run migration is read-only and repeated migration preserves financial values and accepted snapshots", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const p = await M.Product.findOne({ name: { $exists: true } });
  const o = await M.Order.create({
    customer: ids.customer,
    product: p.id,
    quantity: 1,
    productCents: 10000,
    totalCents: 10000,
    paidCents: 5000,
    border: "Hairatan",
    acceptedAt: new Date(),
    acceptedSnapshot: { version: 1, totalCents: 10000 },
    status: "Deposit pending",
  });
  const env = {
    ...process.env,
    NODE_ENV: "test",
    MONGODB_URI: repl.getUri(),
    JWT_SECRET: "u".repeat(64),
    DOCUMENT_UPLOADS_ENABLED: "false",
  };
  await run(process.execPath, ["scripts/migrate-2.2.js"], { env });
  assert.equal((await M.Order.findById(o.id)).items.length, 0);
  await run(process.execPath, ["scripts/migrate-2.2.js", "--apply"], { env });
  const first = await M.Order.findById(o.id);
  await run(process.execPath, ["scripts/migrate-2.2.js", "--apply"], { env });
  const again = await M.Order.findById(o.id);
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items.toObject(), again.items.toObject());
  assert.equal(again.paidCents, 5000);
  assert.equal(again.acceptedSnapshot.totalCents, 10000);
});
test("issued invoices preserve commercial snapshots and cannot be modified", async () => {
  const o = await M.Order.findOne({ status: "Delivered" });
  assert.ok(o);
  const a = await call("seller", "post", `/orders/${o.id}/invoices`, {}).expect(
    201,
  );
  const b = await call("seller", "post", `/orders/${o.id}/invoices`, {}).expect(
    201,
  );
  assert.equal(a.body._id, b.body._id);
  await M.Product.updateOne(
    { _id: o.product },
    { $set: { "name.en": "Edited later" } },
  );
  const saved = await M.Invoice.findById(a.body._id);
  assert.notEqual(saved.snapshot.items[0].snapshot.name.en, "Edited later");
  await assert.rejects(
    M.Invoice.updateOne({ _id: saved.id }, { $set: { number: "FORGED" } }),
    /Append-only/,
  );
  await call("customer", "get", `/invoices/${saved.id}/pdf`).expect(200);
});
test("concurrent order acceptance cannot reserve the same stock twice", async () => {
  const p = await M.Product.create({ name: { en: "Concurrent stock" } }),
    w = await M.Warehouse.create({ name: "Concurrent warehouse" });
  const batch = await M.Batch.create({
    product: p.id,
    warehouse: w.id,
    code: "ONLY",
    quantity: 10,
    unitCostCents: 100,
    valueCents: 1000,
  });
  const orders = [];
  for (let n = 0; n < 2; n++) {
    const inquiry = await call("customer", "post", "/inquiries", {
      product: p.id,
      quantity: 10,
    }).expect(201);
    const o = await call(
      "seller",
      "post",
      `/inquiries/${inquiry.body._id}/proforma`,
      { productTotal: 100, border: "Hairatan" },
    ).expect(201);
    orders.push(o.body);
  }
  await Promise.all(
    orders.map((o) =>
      call("customer", "post", `/orders/${o._id}/accept`, {}).expect(200),
    ),
  );
  const rows = await M.StockReservation.find({
    batch: batch.id,
    status: "Active",
  });
  assert.equal(
    rows.reduce((n, r) => n + r.quantity, 0),
    10,
  );
  assert.equal((await M.Batch.findById(batch.id)).reservedQuantity, 10);
  assert.equal(new Set(rows.map((r) => String(r.order))).size, 1);
});
