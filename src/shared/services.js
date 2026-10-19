import mongoose from "mongoose";
import { operationContext } from "../modules/platform/idempotency.middleware.js";
import * as M from "../models.js";
import { accountNames } from "../modules/accounting/chart.service.js";
import { RuleError, requireRule, balanced } from "./rules.js";
export const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
export const tx = async (fn) => {
  const s = await mongoose.startSession(),
    context = operationContext.getStore();
  try {
    let out;
    await s.withTransaction(
      async () => {
        if (context) {
          const prior = await M.Idempotency.findOne({
            key: context.key,
          }).session(s);
          if (prior) {
            requireRule(
              prior.fingerprint === context.fingerprint,
              "Idempotency key reused with different request",
            );
            out = prior.response;
            return;
          }
          await M.Idempotency.create(
            [{ ...context, expiresAt: new Date(Date.now() + 86400000) }],
            { session: s },
          );
        }
        out = await fn(s);
        if (context)
          await M.Idempotency.updateOne(
            { key: context.key },
            { $set: { response: JSON.parse(JSON.stringify(out)) } },
            { session: s },
          );
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 10000,
      },
    );
    return out;
  } catch (e) {
    if (context && e.code === 11000) {
      const prior = await M.Idempotency.findOne({ key: context.key }).lean();
      if (
        prior &&
        prior.fingerprint === context.fingerprint &&
        prior.response !== undefined
      )
        return prior.response;
    }
    throw e;
  } finally {
    await s.endSession();
  }
};
export const audit = async (req, s, action, entity, value, details = {}) => {
  const result = await M.Audit.create(
    [{ actor: req.user.id, action, entity, entityId: String(value), details }],
    { session: s },
  );
  if (entity === "Order") {
    const order = await M.Order.findById(value).session(s);
    if (order) {
      const party = await M.Party.findById(order.customer).session(s);
      if (party?.userId)
        await M.Notification.create(
          [{ user: party.userId, action, entity, entityId: String(value) }],
          { session: s },
        );
    }
  }
  return result;
};
export const line = (account, dr = 0, cr = 0) => ({
  account,
  debitCents: dr,
  creditCents: cr,
});
export const post = async (
  req,
  s,
  memo,
  reference,
  lines,
  order,
  extra = {},
) => {
  lines = lines.filter((l) => l.debitCents || l.creditCents);
  if (!lines.length) return [];
  balanced(lines);
  requireRule(
    lines.every((l) => accountNames.has(l.account)) ||
      (await M.Account.countDocuments({
        name: {
          $in: [
            ...new Set(
              lines.map((l) => l.account).filter((n) => !accountNames.has(n)),
            ),
          ],
        },
        active: true,
      }).session(s)) ===
        [
          ...new Set(
            lines.map((l) => l.account).filter((n) => !accountNames.has(n)),
          ),
        ].length,
    "Unknown ledger account",
  );
  const closed = await M.AccountingPeriod.exists({
    month: new Date().toISOString().slice(0, 7),
    closedAt: { $ne: null },
  }).session(s);
  requireRule(!closed, "Accounting period closed");
  return M.Journal.create(
    [{ memo, reference, lines, postedBy: req.user.id, order, ...extra }],
    { session: s },
  );
};
export const roles =
  (...allowed) =>
  (req, res, next) =>
    allowed.includes(req.user.role)
      ? next()
      : next(new RuleError("Access denied", 403));
export const manage = roles("admin", "manager"),
  sales = roles("admin", "manager", "seller"),
  procure = roles("admin", "manager", "procurement");
export function positive(v, label = "Quantity") {
  requireRule(
    typeof v === "number" && Number.isFinite(v) && v > 0,
    label + " must be positive",
  );
  return v;
}
export const id = (v) => {
  requireRule(
    typeof v === "string" && /^[a-f\d]{24}$/i.test(v),
    "Invalid record ID",
  );
  return v;
};
export const entity = async (Model, value, s) => {
  const key = typeof value === "object" && value ? value.toString() : value;
  const o = await Model.findById(id(key)).session(s || null);
  if (!o) throw new RuleError("Record not found", 404);
  return o;
};
export async function ownOrder(req, value, s) {
  const o = await entity(M.Order, value, s);
  if (req.user.role === "customer") {
    const party = await M.Party.findOne({
      _id: o.customer,
      userId: req.user.id,
    }).session(s || null);
    if (!party) throw new RuleError("Record not found", 404);
  }
  return o;
}
export async function list(Model, filter, query, options = {}) {
  const limit = query.limit ? Number(query.limit) : 25;
  const match = { ...filter };
  if (query.cursor)
    match._id = { $lt: new mongoose.Types.ObjectId(query.cursor) };
  const items = await Model.find(match)
    .select(options.select || "")
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean()
    .maxTimeMS(5000);
  const more = items.length > limit;
  if (more) items.pop();
  await attachLabels(Model, items);
  return { items, nextCursor: more ? String(items.at(-1)._id) : null };
}

export async function attachLabels(Model, items) {
  const refs = Object.entries(Model.schema.paths).filter(
    ([, p]) => p.options.ref,
  );
  await Promise.all(
    refs.map(async ([key, p]) => {
      const ids = [
        ...new Set(
          items
            .map((x) => x[key])
            .filter(Boolean)
            .map(String),
        ),
      ];
      if (!ids.length) return;
      const Ref = mongoose.model(p.options.ref);
      const records = await Ref.find({ _id: { $in: ids } })
        .select("name code reference productSnapshot")
        .lean()
        .maxTimeMS(5000);
      const names = new Map(
        records.map((x) => [
          String(x._id),
          x.name ||
            x.code ||
            x.reference ||
            x.productSnapshot?.name ||
            "#" + String(x._id).slice(-8),
        ]),
      );
      for (const item of items)
        if (names.has(String(item[key]))) {
          item._labels ||= {};
          item._labels[key] = names.get(String(item[key]));
        }
    }),
  );
  return items;
}
