import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import * as M from "../src/models.js";
import { hashPassword } from "../src/modules/auth/password.service.js";
import { drawCompanyHeader } from "../src/modules/settings/pdf-branding.service.js";
let repl, app, png;
const tokens = {};
const password = "Profile-Test-Password-93!";
const auth = (req, role = "admin") =>
  req.set("Authorization", `Bearer ${tokens[role]}`);
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
      JWT_SECRET: "p".repeat(64),
      DOCUMENT_UPLOADS_ENABLED: "false",
    }),
  );
  const hash = await hashPassword(password, 16384);
  for (const role of [
    "admin",
    "manager",
    "seller",
    "procurement",
    "customer",
  ]) {
    await M.User.create({
      name: role,
      email: `${role}@profile.test`,
      role,
      passwordHash: hash,
      emailVerified: true,
    });
    tokens[role] = (
      await request(app)
        .post("/api/auth/login")
        .send({ email: `${role}@profile.test`, password })
        .expect(200)
    ).body.accessToken;
  }
  png = await sharp({
    create: { width: 600, height: 400, channels: 3, background: "#08745c" },
  })
    .png()
    .toBuffer();
});
after(async () => {
  await mongoose.disconnect();
  await repl?.stop();
});
test("public settings whitelist and administrator-only revision protected updates", async () => {
  const initial = (await request(app).get("/api/settings/public").expect(200))
    .body;
  assert.equal(initial.revision, 0);
  assert.equal(initial.updatedBy, undefined);
  for (const role of ["manager", "seller", "procurement", "customer"])
    await auth(request(app).get("/api/admin/settings"), role).expect(403);
  const { logoVersion, ...fields } = initial;
  const payload = {
    ...fields,
    name: "Test Trading",
    tagline: "Quality goods",
    aboutTitle: "About us",
    aboutBody: "Company story",
    contactEmail: "contact@example.com",
    contactPhone: "123",
    address: "Kabul",
    workingHours: "9–5",
    website: "https://example.com",
  };
  await auth(request(app).patch("/api/admin/settings"))
    .send({ ...payload, website: "javascript:alert(1)" })
    .expect(422);
  await auth(request(app).patch("/api/admin/settings"))
    .send({ ...payload, role: "admin" })
    .expect(422);
  for (const role of ["manager", "seller", "procurement", "customer"])
    await auth(request(app).patch("/api/admin/settings"), role)
      .send(payload)
      .expect(403);
  const saved = (
    await auth(request(app).patch("/api/admin/settings"))
      .send(payload)
      .expect(200)
  ).body;
  assert.equal(saved.name, "Test Trading");
  assert.equal(saved.revision, 1);
  await auth(request(app).patch("/api/admin/settings"))
    .send(payload)
    .expect(409);
  assert.equal(
    (await request(app).get("/api/settings/public")).body.aboutBody,
    "Company story",
  );
});
test("logo validates image bytes, normalizes, renders in PDF and removes", async () => {
  const upload = (bytes = png, role = "admin", revision = "1") =>
    auth(request(app).post("/api/admin/settings/logo"), role)
      .set("X-Settings-Revision", revision)
      .set("Content-Type", "image/png")
      .send(bytes);
  await upload(png, "customer").expect(403);
  await upload(Buffer.from("invalid")).expect(422);
  const saved = (await upload().expect(201)).body;
  assert.ok(saved.logoVersion);
  await upload(png, "admin", "1").expect(409);
  const image = await request(app).get("/api/settings/logo").expect(200);
  assert.equal((await sharp(image.body).metadata()).format, "webp");
  const doc = new PDFDocument();
  const chunks = [];
  doc.on("data", (x) => chunks.push(x));
  const finished = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  await drawCompanyHeader(doc);
  doc.end();
  await finished;
  assert.match(Buffer.concat(chunks).subarray(0, 8).toString(), /^%PDF/);
  await auth(request(app).post("/api/admin/settings/logo/remove"))
    .send({ revision: saved.revision })
    .expect(200);
  await request(app).get("/api/settings/logo").expect(404);
});
test("all roles edit only their own whitelisted profile fields", async () => {
  for (const role of Object.keys(tokens)) {
    const profile = (
      await auth(request(app).patch("/api/me/profile"), role)
        .send({
          name: `Updated ${role}`,
          phone: "123",
          country: "Afghanistan",
          address: "Kabul",
        })
        .expect(200)
    ).body;
    assert.equal(profile.role, role);
    assert.equal(profile.name, `Updated ${role}`);
    assert.equal(profile.passwordHash, undefined);
    await auth(request(app).patch("/api/me/profile"), role)
      .send({
        name: "Changed",
        phone: "",
        country: "",
        address: "",
        role: "admin",
      })
      .expect(422);
  }
  await request(app).get("/api/me/profile").expect(401);
});
test("photos are private, normalized, replaceable and removable", async () => {
  const upload = () =>
    auth(request(app).post("/api/me/avatar"), "customer")
      .set("Content-Type", "image/png")
      .send(png);
  const first = (await upload().expect(201)).body;
  assert.ok(first.avatarVersion);
  await request(app).get(`/api/me/avatar/${first.avatarVersion}`).expect(401);
  await auth(
    request(app).get(`/api/me/avatar/${first.avatarVersion}`),
    "seller",
  ).expect(404);
  const photo = await auth(
    request(app).get("/api/me/avatar"),
    "customer",
  ).expect(200);
  assert.ok((await sharp(photo.body).metadata()).width <= 320);
  assert.match(photo.headers["cache-control"], /private/);
  const second = (await upload().expect(201)).body;
  assert.notEqual(second.avatarVersion, first.avatarVersion);
  assert.equal(await M.ProfileImage.countDocuments(), 1);
  await auth(request(app).post("/api/me/avatar/remove"), "customer")
    .send({})
    .expect(200);
  await auth(request(app).get("/api/me/avatar"), "customer").expect(404);
});
test("session metadata hides tokens and revocation enforces ownership", async () => {
  const sessions = (
    await auth(request(app).get("/api/auth/sessions"), "customer").expect(200)
  ).body.items;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].current, true);
  assert.equal(sessions[0].user, undefined);
  assert.equal(sessions[0].tokenHash, undefined);
  await auth(
    request(app).post(`/api/auth/sessions/${sessions[0]._id}/revoke`),
    "seller",
  )
    .send({})
    .expect(404);
  await auth(
    request(app).post(`/api/auth/sessions/${sessions[0]._id}/revoke`),
    "customer",
  )
    .send({})
    .expect(200);
  await auth(request(app).get("/api/me/profile"), "customer").expect(401);
});

test("inactive product video is restricted to staff and supports bounded range reads", async () => {
  const owner = await M.User.findOne({ role: "admin" });
  const p = await M.Product.create({
    name: { en: "Private beans" },
    active: false,
  });
  const data = Buffer.from("0123456789abcdef");
  const video = await M.ProductVideo.create({
    product: p.id,
    owner: owner.id,
    size: data.length,
    mime: "video/mp4",
    received: data.length,
    chunks: 1,
    state: "Ready",
  });
  await M.ProductVideoChunk.create({ video: video.id, ordinal: 0, data });
  p.video = video.id;
  await p.save();
  await request(app).get(`/api/catalog/${p.id}/video`).expect(404);
  await request(app).get(`/api/products/${p.id}/video-info`).expect(401);
  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "customer@profile.test", password })
    .expect(200);
  await request(app)
    .get(`/api/products/${p.id}/video-info`)
    .set("Authorization", `Bearer ${login.body.accessToken}`)
    .expect(403);
  for (const role of ["admin", "manager", "seller", "procurement"]) {
    assert.equal(
      (
        await auth(
          request(app).get(`/api/products/${p.id}/video-info`),
          role,
        ).expect(200)
      ).body.size,
      data.length,
    );
    const r = await auth(request(app).get(`/api/products/${p.id}/video`), role)
      .set("Range", "bytes=2-5")
      .expect(206);
    assert.equal(r.headers["content-range"], "bytes 2-5/16");
    assert.match(r.headers["cache-control"], /private/);
  }
});
