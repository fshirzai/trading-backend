import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { seedDemo, SeedRun } from "../src/database/seed.service.js";
import * as M from "../src/models.js";
let repl, app, config;
const tokens = {};
const password = "Existing-Administrator-93!";
const demoPassword = "Private-Demo-Password-93!";
const body = () => ({
  adminPassword: password,
  demoPassword,
  confirmation: "ADD DEMO DATA",
});
const call = (role, method, body) => {
  const req = request(app)[method]("/api/admin/demo-data");
  if (role) req.set("Authorization", "Bearer " + tokens[role]);
  return body ? req.send(body) : req;
};
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, args: ["--nounixsocket"] },
  });
  await mongoose.connect(repl.getUri());
  for (const m of Object.values(M)) await m.init();
  config = readConfig({
    NODE_ENV: "test",
    JWT_SECRET: "a".repeat(64),
    MONGODB_URI: repl.getUri(),
  });
  await seedDemo(config, password);
  app = await createApp(config);
  for (const role of ["admin", "manager", "seller", "procurement", "customer"])
    tokens[role] = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: role + "@demo.test", password })
        .expect(200)
    ).body.accessToken;
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
test("admin demo data is disabled by default and rejects anonymous and other roles", async () => {
  assert.equal((await call("admin", "get").expect(200)).body.enabled, false);
  await call(null, "get").expect(401);
  for (const role of ["manager", "seller", "procurement", "customer"]) {
    await call(role, "get").expect(403);
    await call(role, "post", body()).expect(403);
  }
  await call("admin", "post", body()).expect(403);
});
test("demo seed requires confirmation and reauthentication and rolls back conflicting accounts", async () => {
  config.demoDataEnabled = true;
  await call("admin", "post", { ...body(), confirmation: "yes" }).expect(422);
  await call("admin", "post", { ...body(), adminPassword: "wrong" }).expect(
    403,
  );
  const count = await M.User.countDocuments();
  const conflict = await M.User.create({
    name: "Existing account",
    email: "seller.v25@demo.test",
    passwordHash: "do-not-touch",
    role: "seller",
  });
  await call("admin", "post", body()).expect(409);
  assert.equal(await M.User.countDocuments(), count + 1);
  assert.equal(await M.Product.countDocuments({ sku: /DEMO25/ }), 0);
  assert.equal(await SeedRun.countDocuments({ key: "admin-demo-v2.5" }), 0);
  assert.equal(
    await M.User.countDocuments({ email: "manager.v25@demo.test" }),
    0,
  );
  await M.User.deleteOne({ _id: conflict.id });
});
test("admin seeds once with matching photos, all roles, balanced stock and unchanged existing records", async () => {
  const original = await M.User.findOne({ role: "admin" })
    .select("+passwordHash")
    .lean();
  const count = await M.Product.countDocuments();
  const result = (await call("admin", "post", body()).expect(200)).body;
  assert.deepEqual(result.counts, {
    newUsers: 4,
    products: 3,
    images: 3,
    warehouses: 2,
    batches: 6,
    purchases: 6,
    inquiries: 3,
  });
  assert.equal(result.accounts.length, 5);
  assert.equal(result.accounts[0].existing, true);
  assert.ok(!JSON.stringify(result).includes(demoPassword));
  assert.equal(await M.User.countDocuments({ role: "admin" }), 1);
  assert.equal(
    (await M.User.findById(original._id).select("+passwordHash")).passwordHash,
    original.passwordHash,
  );
  assert.equal(await M.Product.countDocuments(), count + 3);
  for (const id of result.productIds) {
    const p = await M.Product.findById(id);
    assert.ok(p.name.en && p.name.ps && p.name.fa);
    assert.equal(p.images.length, 1);
    const response = await request(app)
      .get("/api/catalog/" + id + "/images/" + p.images[0].id)
      .expect(200);
    assert.match(response.headers["content-type"], /image\/webp/);
    const image = await M.ProductImage.findById(p.images[0].id).select(
      "+data +thumbnail",
    );
    assert.ok(image.data.length > 1000 && image.thumbnail.length > 100);
    assert.equal(String(image.product), id);
    const batches = await M.Batch.find({ product: id });
    assert.deepEqual(
      batches.map((b) => b.quantity).sort((a, b) => a - b),
      [10, 20],
    );
    assert.equal(
      batches.reduce((a, b) => a + b.quantity, 0),
      30,
    );
  }
  const journal = await M.Journal.findOne({
    reference: "seed:admin-demo-v2.5",
  });
  assert.equal(
    journal.lines.reduce((a, l) => a + l.debitCents - l.creditCents, 0),
    0,
  );
  const again = (await call("admin", "post", body()).expect(200)).body;
  assert.deepEqual(again, result);
  assert.equal(await M.Product.countDocuments(), count + 3);
  const status = (await call("admin", "get").expect(200)).body;
  assert.equal(status.seeded, true);
  for (const role of ["manager", "seller", "procurement", "customer"])
    await request(app)
      .post("/api/auth/login")
      .send({ email: role + ".v25@demo.test", password: demoPassword })
      .expect(200);
  assert.equal(await M.Audit.countDocuments({ action: "demo-data.create" }), 1);
});
