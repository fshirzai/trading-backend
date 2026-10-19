import * as M from "../models.js";
import { model, Schema } from "../shared/model.js";
import { hashPassword } from "../modules/auth/password.service.js";
import { tx } from "../shared/services.js";
import { requireRule } from "../shared/rules.js";
export const SeedRun = model("SeedRun", {
  key: { type: String, unique: true },
  result: Schema.Types.Mixed,
});
export async function seedDemo(config, password) {
  requireRule(
    config.mode !== "production",
    "Demo seed is forbidden in production",
  );
  requireRule(
    password && password.length >= 12,
    "SEED_PASSWORD of at least 12 characters required",
  );
  await SeedRun.init();
  const hash = await hashPassword(password, config.scryptN);
  return tx(async (s) => {
    const old = await SeedRun.findOne({ key: "demo-v2" }).session(s);
    if (old) return old.result;
    requireRule(
      !(await M.User.exists({ role: "admin" }).session(s)),
      "Demo seed requires an empty database without an admin",
    );
    const users = {};
    for (const role of [
      "admin",
      "manager",
      "seller",
      "procurement",
      "customer",
    ]) {
      const [u] = await M.User.create(
        [
          {
            name: "Demo " + role,
            email: role + "@demo.test",
            role,
            passwordHash: hash,
            emailVerified: true,
          },
        ],
        { session: s },
      );
      users[role] = u.id;
    }
    const [customer, supplier] = await M.Party.create(
      [
        {
          name: "Atlas Foods",
          type: "customer",
          country: "China",
          userId: users.customer,
        },
        {
          name: "Kunar Agricultural Co.",
          type: "supplier",
          country: "Afghanistan",
        },
      ],
      { session: s, ordered: true },
    );
    const warehouses = await M.Warehouse.create(
      [
        { name: "Kabul Central", country: "Afghanistan" },
        { name: "Mazar Distribution", country: "Afghanistan" },
        { name: "Herat West", country: "Afghanistan" },
      ],
      { session: s, ordered: true },
    );
    const products = await M.Product.create(
      [
        {
          name: { en: "Red kidney beans", ps: "سره لوبیا", fa: "لوبیای سرخ" },
          grade: "A",
          origin: "Afghanistan",
          packaging: "50 kg",
          moq: 1,
        },
        {
          name: { en: "Chickpeas", ps: "نخود", fa: "نخود" },
          grade: "A",
          packaging: "50 kg",
          moq: 1,
        },
        {
          name: { en: "Lentils", ps: "دال", fa: "عدس" },
          grade: "A",
          packaging: "50 kg",
          moq: 1,
        },
      ],
      { session: s, ordered: true },
    );
    const [purchase] = await M.Purchase.create(
      [
        {
          supplier: supplier.id,
          product: products[0].id,
          quantity: 100,
          costCents: 600000,
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
          product: products[0].id,
          warehouse: warehouses[0].id,
          code: "DEMO-001",
          quantity: 100,
          unitCostCents: 6000,
          valueCents: 600000,
        },
      ],
      { session: s },
    );
    await M.Movement.create(
      [
        {
          batch: batch.id,
          quantity: 100,
          kind: "Receipt",
          reference: purchase.id,
        },
      ],
      { session: s },
    );
    await M.Journal.create(
      [
        {
          memo: "Opening capital",
          reference: "seed:capital",
          postedBy: users.admin,
          lines: [
            { account: "Bank", debitCents: 2000000, creditCents: 0 },
            { account: "Owner capital", debitCents: 0, creditCents: 2000000 },
          ],
        },
        {
          memo: "Demo purchase receipt",
          reference: "seed:receipt",
          postedBy: users.admin,
          lines: [
            { account: "Inventory", debitCents: 600000, creditCents: 0 },
            { account: "Accounts payable", debitCents: 0, creditCents: 600000 },
          ],
        },
      ],
      { session: s, ordered: true },
    );
    const [inquiry] = await M.Inquiry.create(
      [
        {
          customer: customer.id,
          product: products[0].id,
          quantity: 100,
          source: "whatsapp",
          destination: "China",
        },
      ],
      { session: s },
    );
    await M.Employee.create(
      [
        {
          name: "Demo seller",
          job: "Sales",
          salaryCents: 50000,
          advanceCents: 0,
        },
      ],
      { session: s },
    );
    const result = {
      users,
      customer: customer.id,
      supplier: supplier.id,
      product: products[0].id,
      warehouse: warehouses[0].id,
      purchase: purchase.id,
      inquiry: inquiry.id,
    };
    await SeedRun.create([{ key: "demo-v2", result }], { session: s });
    return result;
  });
}
