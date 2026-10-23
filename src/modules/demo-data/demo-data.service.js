import { readFile } from "node:fs/promises";
import * as M from "../../models.js";
import { SeedRun } from "../../database/seed.service.js";
import { hashPassword } from "../auth/password.service.js";
import { normalizeProductImage } from "../catalog/product-images.service.js";
import { tx, audit } from "../../shared/services.js";
import { requireRule } from "../../shared/rules.js";
export const DEMO_KEY = "admin-demo-v2.5";
const definitions = [
  {
    asset: "beans",
    file: new URL("./assets/beans.webp", import.meta.url),
    sku: "DEMO25-BEANS",
    name: { en: "Red kidney beans", ps: "سرې لوبیا", fa: "لوبیای سرخ" },
  },
  {
    asset: "chickpeas",
    file: new URL("./assets/chickpeas.webp", import.meta.url),
    sku: "DEMO25-CHICKPEAS",
    name: { en: "Chickpeas", ps: "نخود", fa: "نخود" },
  },
  {
    asset: "lentils",
    file: new URL("./assets/lentils.webp", import.meta.url),
    sku: "DEMO25-LENTILS",
    name: { en: "Red lentils", ps: "سره دال", fa: "دال سرخ" },
  },
];
export async function addAdminDemoData(req, config, password) {
  requireRule(
    config.demoDataEnabled,
    "Demo data is disabled; enable DEMO_DATA_ENABLED temporarily",
    403,
  );
  await SeedRun.init();
  const old = await SeedRun.findOne({ key: DEMO_KEY }).lean();
  if (old) return old.result;
  const hash = await hashPassword(password, config.scryptN);
  const images = [];
  for (const d of definitions)
    images.push(
      await normalizeProductImage(await readFile(d.file), "image/webp"),
    );
  return tx(async (s) => {
    const prior = await SeedRun.findOne({ key: DEMO_KEY }).session(s);
    if (prior) return prior.result;
    // Claim this release before writes; the unique key serializes concurrent seed attempts.
    await SeedRun.create([{ key: DEMO_KEY }], { session: s });
    const accounts = [];
    const users = { admin: req.user.id };
    const administrator = await M.User.findById(req.user.id).session(s);
    accounts.push({
      role: "admin",
      email: administrator.email,
      existing: true,
    });
    for (const role of ["manager", "seller", "procurement", "customer"]) {
      const email = role + ".v25@demo.test";
      requireRule(
        !(await M.User.exists({ email }).session(s)),
        "Demo email already exists; no records were changed",
        409,
      );
      const [u] = await M.User.create(
        [
          {
            name: "DEMO " + role,
            email,
            role,
            passwordHash: hash,
            emailVerified: true,
          },
        ],
        { session: s },
      );
      users[role] = u.id;
      accounts.push({ role, email, existing: false });
    }
    const [customer, supplier] = await M.Party.create(
      [
        {
          name: "DEMO customer company",
          type: "customer",
          country: "Afghanistan",
          userId: users.customer,
        },
        {
          name: "DEMO agricultural supplier",
          type: "supplier",
          country: "Afghanistan",
        },
      ],
      { session: s, ordered: true },
    );
    const warehouses = await M.Warehouse.create(
      [
        {
          name: "DEMO Kabul",
          country: "Afghanistan",
          address: "Demo warehouse — Kabul",
        },
        {
          name: "DEMO Ghazni",
          country: "Afghanistan",
          address: "Demo warehouse — Ghazni",
        },
      ],
      { session: s, ordered: true },
    );
    const products = [];
    let totalValue = 0;
    for (const [index, d] of definitions.entries()) {
      requireRule(
        !(await M.Product.exists({ sku: d.sku }).session(s)),
        "Demo SKU already exists; no records were changed",
        409,
      );
      const [product] = await M.Product.create(
        [
          {
            sku: d.sku,
            name: d.name,
            category: "Pulses",
            grade: "A",
            origin: "Afghanistan",
            packaging: "25 kg bag",
            unit: "tonne",
            moq: 1,
          },
        ],
        { session: s },
      );
      const image = images[index];
      const [photo] = await M.ProductImage.create(
        [
          {
            product: product.id,
            data: image.data,
            thumbnail: image.thumbnail,
            mime: "image/webp",
          },
        ],
        { session: s },
      );
      product.images = [
        {
          id: photo.id,
          width: image.width,
          height: image.height,
          size: image.size,
        },
      ];
      await product.save({ session: s });
      products.push(product);
      for (const [w, warehouse] of warehouses.entries()) {
        const quantity = w === 0 ? 10 : 20;
        const value = quantity * 100000;
        totalValue += value;
        const [purchase] = await M.Purchase.create(
          [
            {
              supplier: supplier.id,
              product: product.id,
              quantity,
              costCents: value,
              paidCents: 0,
              status: "Received",
              receivedAt: new Date(),
            },
          ],
          { session: s },
        );
        const [batch] = await M.Batch.create(
          [
            {
              product: product.id,
              warehouse: warehouse.id,
              code: d.sku + "-" + w,
              quantity,
              unitCostCents: 100000,
              valueCents: value,
              purchase: purchase.id,
              location: "DEMO shelf " + (index + 1),
              condition: "Good",
            },
          ],
          { session: s },
        );
        await M.Movement.create(
          [
            {
              batch: batch.id,
              quantity,
              kind: "Receipt",
              reference: purchase.id,
              actor: req.user.id,
            },
          ],
          { session: s },
        );
      }
      await M.Inquiry.create(
        [
          {
            customer: customer.id,
            product: product.id,
            quantity: 5,
            source: "website",
            destination: "DEMO Kabul delivery",
            preferredPayment: "TT",
            cartRequest: true,
            items: [
              {
                product: product.id,
                quantity: 5,
                snapshot: { name: d.name, unit: "tonne" },
              },
            ],
          },
        ],
        { session: s },
      );
    }
    await M.Journal.create(
      [
        {
          memo: "DEMO 2.5 sample purchase receipts",
          reference: "seed:admin-demo-v2.5",
          postedBy: req.user.id,
          lines: [
            { account: "Inventory", debitCents: totalValue, creditCents: 0 },
            {
              account: "Accounts payable",
              debitCents: 0,
              creditCents: totalValue,
            },
          ],
        },
      ],
      { session: s },
    );
    const result = {
      createdAt: new Date().toISOString(),
      accounts,
      productIds: products.map((p) => p.id),
      warehouses: warehouses.map((w) => ({ id: w.id, name: w.name })),
      counts: {
        newUsers: 4,
        products: 3,
        images: 3,
        warehouses: 2,
        batches: 6,
        purchases: 6,
        inquiries: 3,
      },
      note: "The existing administrator password is unchanged. Demo passwords are never stored in this result.",
    };
    await SeedRun.updateOne(
      { key: DEMO_KEY },
      { $set: { result } },
      { session: s },
    );
    await audit(req, s, "demo-data.create", "SeedRun", DEMO_KEY, {
      counts: result.counts,
    });
    return result;
  });
}
