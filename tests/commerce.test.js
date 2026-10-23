import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { seedDemo } from "../src/database/seed.service.js";
import { convertAfn } from "../src/modules/payments/hesabpay.service.js";
import * as M from "../src/models.js";
let repl, app, config, ids, merchant, checkout, png;
const tokens = {},
  calls = [];
const password = "Commerce-Test-Password-93!";
const call = (role, method, path, body, key = randomUUID()) => {
  const r = request(app)
    [method]("/api" + path)
    .set("Authorization", "Bearer " + tokens[role])
    .set("Idempotency-Key", key);
  return body === undefined ? r : r.send(body);
};
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
    JWT_SECRET: "c".repeat(64),
    DOCUMENT_UPLOADS_ENABLED: "false",
  });
  config.hesabFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return {
      ok: true,
      json: async () =>
        url.endsWith("create-session")
          ? {
              success: true,
              url: "https://api-sandbox.hesab.com/checkout/test-session",
            }
          : { success: JSON.parse(opts.body).signature === "valid-signature" },
    };
  };
  ids = await seedDemo(config, password);
  app = await createApp(config);
  for (const role of ["admin", "manager", "seller", "customer"])
    tokens[role] = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: role + "@demo.test", password })
        .expect(200)
    ).body.accessToken;
  png = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#ddd" },
  })
    .png()
    .toBuffer();
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
test("catalog filters run server-side and product details hide inactive products", async () => {
  const p = await M.Product.create({
    name: { en: "Unique walnuts" },
    category: "Nuts",
    origin: "Afghanistan",
    grade: "Premium",
    sku: "NUT-X",
  });
  const hidden = await M.Product.create({
    name: { en: "Hidden" },
    category: "Secret",
    active: false,
  });
  const list = (
    await request(app)
      .get(
        "/api/catalog?search=walnuts&category=Nuts&origin=Afghanistan&grade=Premium",
      )
      .expect(200)
  ).body;
  assert.deepEqual(
    list.items.map((x) => x._id),
    [p.id],
  );
  assert.equal(
    (await request(app).get("/api/catalog?search=%5B").expect(200)).body.items
      .length,
    0,
  );
  const filters = (await request(app).get("/api/catalog/filters").expect(200))
    .body;
  assert.ok(filters.categories.includes("Nuts"));
  assert.ok(!filters.categories.includes("Secret"));
  await request(app)
    .get("/api/catalog/" + p.id)
    .expect(200);
  await request(app)
    .get("/api/catalog/" + hidden.id)
    .expect(404);
  await request(app).get("/api/catalog?category[$ne]=x").expect(400);
});
test("cart creates one idempotent multi-product inquiry and quotation preserves every line", async () => {
  const p = await M.Product.findById(ids.product);
  const second = await M.Product.create({
    name: { en: "Cart lentils" },
    moq: 2,
  });
  const body = {
    product: p.id,
    quantity: 3,
    items: [
      { product: p.id, quantity: 3 },
      { product: second.id, quantity: 2 },
    ],
    destination: "Kabul warehouse",
    preferredPayment: "VISA",
  };
  const key = randomUUID();
  const inquiry = (
    await call("customer", "post", "/inquiries", body, key).expect(201)
  ).body;
  assert.equal(inquiry.items.length, 2);
  assert.ok(inquiry.items.every((x) => x.snapshot?.name?.en));
  assert.equal(inquiry.preferredPayment, "VISA");
  assert.equal(
    (await call("customer", "post", "/inquiries", body, key).expect(201)).body
      ._id,
    inquiry._id,
  );
  await call("customer", "post", "/inquiries", {
    ...body,
    items: [body.items[0], body.items[0]],
  }).expect(422);
  await call("seller", "post", "/inquiries/" + inquiry._id + "/proforma", {
    items: [{ product: p.id, quantity: 3, productTotal: 100 }],
    productTotal: 100,
    deliveryFees: 0,
    border: "Kabul",
  }).expect(422);
  const quoted = (
    await call("seller", "post", "/inquiries/" + inquiry._id + "/proforma", {
      items: [
        { product: p.id, quantity: 3, productTotal: 100 },
        { product: second.id, quantity: 2, productTotal: 50 },
      ],
      productTotal: 150,
      deliveryFees: 0,
      border: "Kabul",
    }).expect(201)
  ).body;
  assert.equal(quoted.items.length, 2);
  checkout = quoted;
  await call(
    "customer",
    "post",
    "/orders/" + quoted._id + "/accept",
    {},
  ).expect(200);
});
test("admin merchant settings encrypt keys, redact secrets, preserve callback on rate edits and reject stale saves", async () => {
  const body = {
    revision: 0,
    label: "Company sandbox",
    environment: "sandbox",
    apiKey: "test-merchant-api-key-private",
    afnPerUsd: 70,
    enabled: true,
    merchantApproved: true,
  };
  await call("manager", "put", "/admin/settings/hesabpay", body).expect(403);
  await call("customer", "get", "/admin/settings/hesabpay").expect(403);
  merchant = (
    await call("admin", "put", "/admin/settings/hesabpay", body).expect(200)
  ).body;
  assert.ok(merchant.webhookPath);
  assert.ok(!JSON.stringify(merchant).includes(body.apiKey));
  const stored = await M.HesabAccount.findById(merchant.account).select(
    "+apiKeyCipher",
  );
  assert.notEqual(stored.apiKeyCipher, body.apiKey);
  await call("admin", "put", "/admin/settings/hesabpay", body).expect(409);
  const updated = (
    await call("admin", "put", "/admin/settings/hesabpay", {
      ...body,
      revision: 1,
      apiKey: undefined,
      afnPerUsd: 71,
    }).expect(200)
  ).body;
  assert.equal(updated.webhookPath, merchant.webhookPath);
  merchant = updated;
  const methods = (
    await call("customer", "get", "/payment-methods").expect(200)
  ).body;
  assert.equal(methods.methods[0].enabled, true);
  assert.equal(methods.methods[1].enabled, true);
  assert.ok(!JSON.stringify(methods).includes("/webhooks/"));
  assert.ok(!JSON.stringify(methods).includes(body.apiKey));
});
test("HesabPay checkout fixes AFN quote, uses hosted API, and replayed callbacks cannot double credit", async () => {
  const afn = convertAfn(10000, 71000000);
  assert.equal(afn, 710000);
  const body = {
    amount: 100,
    expectedAccount: merchant.account,
    expectedAfnMinor: afn,
  };
  await call(
    "customer",
    "post",
    "/orders/" + checkout._id + "/hesabpay-checkout",
    { ...body, expectedAfnMinor: 1 },
  ).expect(409);
  const key = randomUUID();
  const first = (
    await call(
      "customer",
      "post",
      "/orders/" + checkout._id + "/hesabpay-checkout",
      body,
      key,
    ).expect(200)
  ).body;
  const repeated = (
    await call(
      "customer",
      "post",
      "/orders/" + checkout._id + "/hesabpay-checkout",
      body,
      key,
    ).expect(200)
  ).body;
  assert.equal(first.attempt, repeated.attempt);
  assert.equal(calls.filter((x) => x.url.endsWith("create-session")).length, 1);
  const gateway = calls.find((x) => x.url.endsWith("create-session"));
  assert.equal(gateway.body.items[0].price, 7100);
  assert.equal(
    gateway.headers.Authorization,
    "API-KEY test-merchant-api-key-private",
  );
  assert.ok(!JSON.stringify(first).includes(gateway.body.user_id));
  const event = {
    success: true,
    status_code: 10,
    user_id: gateway.body.user_id,
    transaction_id: "test-payment-1",
    amount: 7100,
    items: gateway.body.items,
    signature: "valid-signature",
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  await request(app)
    .post(merchant.webhookPath)
    .send({ ...event, signature: "invalid" })
    .expect(400);
  await request(app)
    .post(merchant.webhookPath)
    .send({ ...event, amount: 1 })
    .expect(400);
  assert.equal((await M.Order.findById(checkout._id)).paidCents, 0);
  await request(app).post(merchant.webhookPath).send(event).expect(200);
  await request(app).post(merchant.webhookPath).send(event).expect(200);
  assert.equal((await M.Order.findById(checkout._id)).paidCents, 10000);
  assert.equal(await M.Payment.countDocuments({ provider: "hesabpay" }), 1);
  const p = await M.Payment.findOne({ provider: "hesabpay" });
  assert.equal(p.originalAmountMinor, 710000);
  assert.equal(p.amountCents, 10000);
  const journal = await M.Journal.findOne({ reference: "payment:" + p.id });
  assert.ok(journal);
});
test("About defaults exist, photos normalize and removal unlinks persisted bytes", async () => {
  let s = (await request(app).get("/api/settings/public").expect(200)).body;
  assert.ok(s.aboutBody.length > 50);
  assert.equal(s.aboutImages.length, 2);
  assert.ok(s.translations.ps.aboutBody);
  await request(app)
    .post("/api/admin/settings/photos")
    .set("Authorization", "Bearer " + tokens.customer)
    .set("X-Settings-Revision", String(s.revision))
    .set("Content-Type", "image/png")
    .send(png)
    .expect(403);
  s = (
    await request(app)
      .post("/api/admin/settings/photos")
      .set("Authorization", "Bearer " + tokens.admin)
      .set("X-Settings-Revision", String(s.revision))
      .set("Content-Type", "image/png")
      .send(png)
      .expect(201)
  ).body;
  const photo = s.aboutImages.at(-1);
  const image = await request(app)
    .get("/api/settings/photos/" + photo.id)
    .expect(200);
  assert.equal((await sharp(image.body).metadata()).format, "webp");
  const { logoVersion, ...fields } = s;
  const removed = (
    await call("admin", "patch", "/admin/settings", {
      ...fields,
      aboutImages: s.aboutImages.filter((x) => x.id !== photo.id),
    }).expect(200)
  ).body;
  assert.equal(removed.aboutImages.length, 2);
  await request(app)
    .get("/api/settings/photos/" + photo.id)
    .expect(404);
  assert.equal(await M.CompanyPhoto.countDocuments(), 0);
  await M.SystemSettings.updateOne(
    { _id: "company" },
    { $set: { aboutBody: "" } },
  );
  assert.ok(
    (await request(app).get("/api/settings/public")).body.aboutBody.length > 50,
  );
});
