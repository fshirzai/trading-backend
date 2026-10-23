import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { seedDemo } from "../src/database/seed.service.js";
import { quoteLineSnapshot } from "../src/modules/documents/proforma.service.js";
import { amountInWords } from "../src/modules/documents/commercial-pdf.service.js";
import * as M from "../src/models.js";
let repl, app, ids, order;
const tokens = {};
const password = "Proforma-Design-Test-93!";
const call = (role, method, path, body) => {
  const r = request(app)
    [method]("/api" + path)
    .set("Authorization", "Bearer " + tokens[role]);
  return body === undefined ? r : r.send(body);
};
const companyFields = {
  name: "Example exporter",
  tagline: "",
  aboutTitle: "",
  aboutBody: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  workingHours: "",
  website: "",
};
const details = {
  reference: "PI-DESIGN-001",
  issueDate: "2026-10-23",
  validUntil: "2099-12-31",
  loadingPlace: "Ghazni",
  transport: "Truck",
  deliveryTerms: "CPT - agreed point",
  deliveryAddress: "Agreed customs handover",
  buyerContact: "Buyer representative",
  buyerTaxNo: "BUYER-TAX-001",
  notes: "Customs expenses as agreed.",
};
const lines = () => [
  {
    product: ids.product,
    quantity: 25,
    productTotal: 22000,
    packaging: "25 kg woven bags",
    bagCount: 1000,
    bagWeightKg: 25,
    remarks: "Keep dry",
  },
];
async function inquiry() {
  return (
    await call("customer", "post", "/inquiries", {
      product: ids.product,
      quantity: 25,
    }).expect(201)
  ).body;
}
const body = () => ({
  productTotal: 22000,
  deliveryFees: 100,
  border: "CPT - border",
  items: lines(),
  quotationDetails: details,
});
before(async () => {
  repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, args: ["--nounixsocket"] },
  });
  await mongoose.connect(repl.getUri());
  for (const m of Object.values(M)) await m.init();
  const config = readConfig({
    NODE_ENV: "test",
    JWT_SECRET: "p".repeat(64),
    MONGODB_URI: repl.getUri(),
  });
  ids = await seedDemo(config, password);
  app = await createApp(config);
  for (const role of ["admin", "manager", "seller", "customer"])
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
test("packaging math rejects incomplete or mismatched bags and words preserve cents", () => {
  const p = { name: { en: "Beans" }, unit: "tonne", packaging: "50 kg" };
  assert.equal(
    quoteLineSnapshot(p, {
      quantity: 25,
      bagCount: 1000,
      bagWeightKg: 25,
      packaging: "Woven sacks",
    }).packaging,
    "Woven sacks",
  );
  assert.throws(
    () => quoteLineSnapshot(p, { quantity: 25, bagCount: 1000 }),
    /both/,
  );
  assert.throws(
    () =>
      quoteLineSnapshot(p, { quantity: 25, bagCount: 1020, bagWeightKg: 24.5 }),
    /match/,
  );
  assert.equal(amountInWords(2200000), "Twenty Two Thousand US Dollars Only.");
  assert.equal(amountInWords(120), "One US Dollar and Twenty Cents Only.");
});
test("invoice bank profile is admin-only and excluded from public settings", async () => {
  await call("manager", "patch", "/admin/settings", {
    ...companyFields,
    revision: 0,
    invoiceProfile: { bankName: "Not allowed" },
  }).expect(403);
  const saved = (
    await call("admin", "patch", "/admin/settings", {
      ...companyFields,
      revision: 0,
      name: "Example exporter",
      invoiceProfile: {
        registrationNo: "SELLER-REG",
        taxNo: "SELLER-TIN",
        bankName: "Original bank",
        accountName: "Original company",
        accountNumber: "PRIVATE-DEMO-IBAN",
        swiftCode: "DEMOXXXX",
        signatoryName: "Company signatory",
        signatoryPosition: "Director",
      },
    }).expect(200)
  ).body;
  assert.equal(saved.invoiceProfile.accountNumber, "PRIVATE-DEMO-IBAN");
  const pub = (await request(app).get("/api/settings/public").expect(200)).body;
  assert.equal(pub.invoiceProfile, undefined);
  assert.ok(!JSON.stringify(pub).includes("PRIVATE-DEMO-IBAN"));
});
test("manager issues quote with reference shipping and packaging snapshots", async () => {
  const i = await inquiry();
  order = (
    await call(
      "manager",
      "post",
      `/inquiries/${i._id}/proforma`,
      body(),
    ).expect(201)
  ).body;
  assert.equal(order.items[0].snapshot.bagCount, 1000);
  assert.equal(order.items[0].snapshot.packaging, "25 kg woven bags");
  assert.equal(order.quotationDocument.bank.accountNumber, "PRIVATE-DEMO-IBAN");
  assert.equal(order.quotationDocument.buyer.contact, "Buyer representative");
  assert.equal(order.quotationDocument.transport, "Truck");
  await call("customer", "post", `/inquiries/${i._id}/proforma`, body()).expect(
    403,
  );
  const profile = (await call("admin", "get", "/admin/settings").expect(200))
    .body;
  await call("admin", "patch", "/admin/settings", {
    ...companyFields,
    revision: profile.revision,
    invoiceProfile: { bankName: "Changed bank" },
  }).expect(200);
  assert.equal(
    (await M.Order.findById(order._id)).quotationDocument.bank.name,
    "Original bank",
  );
});
test("customer PDF downloads with ownership checks and immutable issued invoice snapshot", async () => {
  const r = await call(
    "customer",
    "get",
    `/orders/${order._id}/documents/proforma.pdf`,
  ).expect(200);
  assert.equal(r.body.subarray(0, 5).toString(), "%PDF-");
  assert.match(r.headers["cache-control"], /private/);
  const other = await M.User.create({
    name: "Other customer",
    email: "other-proforma@test.test",
    role: "customer",
    passwordHash: (
      await M.User.findOne({ email: "customer@demo.test" }).select(
        "+passwordHash",
      )
    ).passwordHash,
    emailVerified: true,
  });
  await M.Party.create({
    name: "Other party",
    type: "customer",
    userId: other.id,
  });
  tokens.other = (
    await request(app)
      .post("/api/auth/login")
      .send({ email: other.email, password })
      .expect(200)
  ).body.accessToken;
  const unauth = await request(app).get(
    `/api/orders/${order._id}/documents/proforma.pdf`,
  );
  assert.equal(unauth.status, 401);
  await call(
    "other",
    "get",
    `/orders/${order._id}/documents/proforma.pdf`,
  ).expect(404);
  await call("customer", "post", `/orders/${order._id}/accept`, {}).expect(200);
  const accepted = await M.Order.findById(order._id);
  assert.equal(
    accepted.acceptedSnapshot.quotationDocument.reference,
    "PI-DESIGN-001",
  );
  const invoice = (
    await call("seller", "post", `/orders/${order._id}/invoices`, {}).expect(
      201,
    )
  ).body;
  assert.equal(invoice.snapshot.quotationDocument.bank.name, "Original bank");
  const pdf = await call(
    "customer",
    "get",
    `/invoices/${invoice._id}/pdf`,
  ).expect(200);
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
});
test("invalid packaging duplicate references and expired acceptance are blocked", async () => {
  const i = await inquiry();
  await call("seller", "post", `/inquiries/${i._id}/proforma`, {
    ...body(),
    items: [{ ...lines()[0], bagCount: 999 }],
  }).expect(422);
  await call("seller", "post", `/inquiries/${i._id}/proforma`, body()).expect(
    409,
  );
  assert.equal((await M.Inquiry.findById(i._id)).status, "New");
  const expired = (
    await call("seller", "post", `/inquiries/${i._id}/proforma`, {
      ...body(),
      quotationDetails: {
        reference: "PI-EXPIRED",
        issueDate: "2020-01-01",
        validUntil: "2020-01-02",
      },
    }).expect(201)
  ).body;
  await call("customer", "post", `/orders/${expired._id}/accept`, {}).expect(
    422,
  );
  await call("seller", "post", `/orders/${expired._id}/revise`, {
    ...body(),
    quotationDetails: {
      reference: "PI-REVISED",
      issueDate: "2026-10-23",
      validUntil: "2099-12-31",
    },
    reason: "Renew validity and packaging",
  }).expect(200);
  const revised = await M.Order.findById(expired._id);
  assert.equal(
    revised.proformaHistory[0].quotationDocument.reference,
    "PI-EXPIRED",
  );
  assert.equal(revised.quotationDocument.reference, "PI-REVISED");
  assert.equal(revised.items[0].snapshot.bagCount, 1000);
});

test("staff can preview an unsaved proforma without creating an order or marking inquiry quoted", async () => {
  const i = await inquiry();
  const before = await M.Order.countDocuments();
  const response = await call(
    "manager",
    "post",
    `/inquiries/${i._id}/proforma/preview`,
    {
      ...body(),
      quotationDetails: { ...details, reference: "PI-DRAFT-001" },
    },
  ).expect(200);
  assert.match(response.headers["content-type"], /application\/pdf/);
  assert.match(response.headers["content-disposition"], /^inline/);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.ok(response.body.subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert.equal(await M.Order.countDocuments(), before);
  assert.equal((await M.Inquiry.findById(i._id)).status, "New");
  await call(
    "customer",
    "post",
    `/inquiries/${i._id}/proforma/preview`,
    body(),
  ).expect(403);
  await call("manager", "post", `/inquiries/${i._id}/proforma/preview`, {
    ...body(),
    items: [{ ...lines()[0], bagCount: 1 }],
  }).expect(422);
  await call("manager", "post", `/inquiries/${i._id}/proforma/preview`, {
    ...body(),
    unexpected: true,
  }).expect(422);
});

test("revision preview keeps the saved version intact and uses revision save permissions", async () => {
  const i = await inquiry();
  const saved = (
    await call("manager", "post", `/inquiries/${i._id}/proforma`, {
      ...body(),
      quotationDetails: { ...details, reference: "PI-PREVIEW-REVISE" },
    }).expect(201)
  ).body;
  await call("manager", "post", `/orders/${saved._id}/revise/preview`, {
    ...body(),
    reason: "Preview revised delivery",
    deliveryFees: 200,
    quotationDetails: {
      ...details,
      reference: "PI-PREVIEW-REVISE",
      transport: "Revised truck",
    },
  }).expect(200);
  const after = await M.Order.findById(saved._id).lean();
  assert.equal(after.version, saved.version);
  assert.equal(after.feesCents, saved.feesCents);
  assert.equal(
    after.quotationDocument.transport,
    saved.quotationDocument.transport,
  );
  assert.equal(after.proformaHistory.length, 0);
  await call("customer", "post", `/orders/${saved._id}/revise/preview`, {
    ...body(),
    reason: "Not allowed",
  }).expect(403);
});
