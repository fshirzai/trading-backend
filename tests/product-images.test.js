import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import sharp from "sharp";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import * as M from "../src/models.js";
import { hashPassword } from "../src/modules/auth/password.service.js";
import { normalizeProductImage } from "../src/modules/catalog/product-images.service.js";
let repl, app, tokens, product, png, hash;
const password = "Image-Test-Password-93!";
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      args: process.platform === "win32" ? [] : ["--nounixsocket"],
    },
  });
  await mongoose.connect(repl.getUri());
  for (const Model of Object.values(M)) await Model.init();
  app = await createApp(
    readConfig({
      NODE_ENV: "test",
      MONGODB_URI: repl.getUri(),
      JWT_SECRET: "i".repeat(64),
      DOCUMENT_UPLOADS_ENABLED: "false",
    }),
  );
  hash = await hashPassword(password, 16384);
  png = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#08745c" },
  })
    .png()
    .toBuffer();
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections))
    await collection.deleteMany({});
  tokens = {};
  for (const role of ["admin", "procurement", "seller", "customer"]) {
    await M.User.create({
      name: role,
      email: `${role}@images.test`,
      role,
      passwordHash: hash,
      emailVerified: true,
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: `${role}@images.test`, password })
      .expect(200);
    tokens[role] = login.body.accessToken;
  }
  product = await M.Product.create({ name: { en: "Image test beans" } });
});
function upload(
  version,
  bytes = png,
  replaceId,
  role = "admin",
  contentType = "image/png",
) {
  return request(app)
    .post(
      `/api/products/${product.id}/images${replaceId ? `/${replaceId}/replace` : ""}`,
    )
    .set("Authorization", `Bearer ${tokens[role]}`)
    .set("X-Product-Version", String(version))
    .set("Content-Type", contentType)
    .send(bytes);
}
test("multiple images persist in MongoDB, publish optimized images and can be reordered/replaced/removed", async () => {
  let r = await upload(0).expect(201);
  const first = r.body.product.images[0].id;
  r = await upload(r.body.product.__v).expect(201);
  const second = r.body.product.images[1].id;
  const publicImage = await request(app)
    .get(`/api/catalog/${product.id}/images/${first}`)
    .expect(200);
  assert.match(publicImage.headers["content-type"], /image\/webp/);
  assert.equal((await sharp(publicImage.body).metadata()).format, "webp");
  const thumb = await request(app)
    .get(`/api/catalog/${product.id}/images/${first}/thumb`)
    .expect(200);
  assert.ok((await sharp(thumb.body).metadata()).width <= 320);
  const list = await request(app).get("/api/catalog").expect(200);
  assert.equal(list.body.items[0].images.length, 2);
  assert.ok(!JSON.stringify(list.body).includes('"data"'));
  assert.equal((await M.ProductImage.findOne()).data, undefined);
  r = await request(app)
    .patch(`/api/products/${product.id}/images`)
    .set("Authorization", `Bearer ${tokens.admin}`)
    .send({ version: r.body.product.__v, imageIds: [second, first] })
    .expect(200);
  assert.equal(r.body.product.images[0].id, second);
  r = await upload(r.body.product.__v, png, second).expect(200);
  const replacement = r.body.product.images[0].id;
  assert.notEqual(replacement, second);
  assert.equal(await M.ProductImage.exists({ _id: second }), null);
  await request(app)
    .get(`/api/catalog/${product.id}/images/${second}`)
    .expect(404);
  r = await request(app)
    .post(`/api/products/${product.id}/images/${replacement}/remove`)
    .set("Authorization", `Bearer ${tokens.admin}`)
    .send({ version: r.body.product.__v })
    .expect(200);
  assert.equal(r.body.product.images[0].id, first);
  assert.equal(await M.ProductImage.countDocuments(), 1);
  assert.equal(await M.Audit.countDocuments({ entity: "Product" }), 5);
});
test("image writes enforce role, file bounds, signatures and active-product visibility", async () => {
  await request(app)
    .post(`/api/products/${product.id}/images`)
    .set("Content-Type", "image/png")
    .send(png)
    .expect(401);
  await upload(0, png, undefined, "customer").expect(403);
  await upload(0, png, undefined, "seller").expect(403);
  await upload(
    0,
    Buffer.from('<svg onload="alert(1)"></svg>'),
    undefined,
    "admin",
    "image/png",
  ).expect(422);
  await upload(0, png, undefined, "admin", "image/jpeg").expect(422);
  await upload(0, Buffer.alloc(3 * 1024 * 1024 + 1)).expect(413);
  assert.equal(await M.ProductImage.countDocuments(), 0);
  const r = await upload(0, png, undefined, "procurement").expect(201);
  const image = r.body.product.images[0].id;
  await M.Product.updateOne({ _id: product.id }, { $set: { active: false } });
  await request(app)
    .get(`/api/catalog/${product.id}/images/${image}`)
    .expect(404);
  await request(app)
    .get(`/api/products/${product.id}/images/${image}`)
    .set("Authorization", `Bearer ${tokens.admin}`)
    .expect(200);
  await request(app)
    .get(`/api/products/${product.id}/images`)
    .set("Authorization", `Bearer ${tokens.customer}`)
    .expect(403);
  const other = await M.Product.create({ name: { en: "Other" } });
  await request(app)
    .get(`/api/catalog/${other.id}/images/${image}`)
    .expect(404);
});
test("concurrent uploads and stale changes cannot exceed limits, lose images or leave orphans", async () => {
  const competing = await Promise.all([upload(0), upload(0)]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await M.ProductImage.countDocuments(), 1);
  let current = await M.Product.findById(product.id);
  const first = current.images[0].id;
  await request(app)
    .patch(`/api/products/${product.id}/images`)
    .set("Authorization", `Bearer ${tokens.admin}`)
    .send({ version: current.__v, imageIds: [first, first] })
    .expect(422);
  await request(app)
    .patch(`/api/records/product/${product.id}`)
    .set("Authorization", `Bearer ${tokens.admin}`)
    .send({ images: [] })
    .expect(422);
  for (let i = 1; i < 8; i++) {
    const r = await upload(current.__v).expect(201);
    current = r.body.product;
  }
  await upload(current.__v).expect(422);
  assert.equal(await M.ProductImage.countDocuments(), 8);
  assert.equal((await M.Product.findById(product.id)).images.length, 8);
});
test("normalization rotates, resizes, strips metadata and rejects invalid image data", async () => {
  const jpeg = await sharp({
    create: { width: 1800, height: 900, channels: 3, background: "#eeeeee" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const normalized = await normalizeProductImage(jpeg, "image/jpeg");
  const metadata = await sharp(normalized.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.height, 1600);
  assert.equal(metadata.width, 800);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  assert.ok(normalized.size <= 1024 * 1024);
  await assert.rejects(
    normalizeProductImage(Buffer.from("not an image"), "image/png"),
  );
});
