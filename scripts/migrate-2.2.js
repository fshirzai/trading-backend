import mongoose from "mongoose";
import { readConfig } from "../src/config.js";
import * as M from "../src/models.js";
import { reserveOrder } from "../src/modules/inventory/reservations.service.js";
const apply = process.argv.includes("--apply");
await mongoose.connect(readConfig().mongoUri);
try {
  const count = await M.Order.countDocuments({
    $or: [{ items: { $exists: false } }, { items: { $size: 0 } }],
  });
  console.log(
    JSON.stringify({ mode: apply ? "apply" : "dry-run", legacyOrders: count }),
  );
  if (apply) {
    for (const m of Object.values(M)) await m.createIndexes();
    for await (const old of M.Order.find({
      $or: [{ items: { $exists: false } }, { items: { $size: 0 } }],
    })) {
      const s = await mongoose.startSession();
      try {
        await s.withTransaction(async () => {
          const o = await M.Order.findById(old.id).session(s);
          if (o.items?.length) return;
          o.items = [
            {
              product: o.product,
              quantity: o.quantity,
              productCents: o.productCents,
              snapshot: o.productSnapshot,
            },
          ];
          const item = String(o.items[0]._id);
          await M.Shipment.updateMany(
            {
              order: o.id,
              $or: [{ item: { $exists: false } }, { item: "legacy" }],
            },
            { $set: { item, product: o.product } },
            { session: s },
          );
          await M.StockReservation.updateMany(
            { order: o.id, item: "legacy" },
            { $set: { item } },
            { session: s },
          );
          await M.ProcurementRequest.updateMany(
            { order: o.id, item: "legacy" },
            { $set: { item } },
            { session: s },
          );
          if (
            o.acceptedAt &&
            ![
              "Delivered",
              "Refunded",
              "Return requested",
              "Cancelled",
            ].includes(o.status)
          )
            await reserveOrder(o, s);
          await o.save({ session: s });
          await M.Audit.create(
            [
              {
                action: "migration.2.2",
                entity: "Order",
                entityId: o.id,
                details: { order: o.id, itemsBackfilled: true },
              },
            ],
            { session: s },
          );
        });
      } finally {
        await s.endSession();
      }
    }
    console.log(
      "Migration completed. Existing prices, payments, acceptance snapshots and journals were preserved.",
    );
  }
} finally {
  await mongoose.disconnect();
}
