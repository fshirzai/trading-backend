import { Batch, StockReservation, Shipment, Warehouse } from "../../models.js";
import { requireRule, quantitySum } from "../../shared/rules.js";
export const orderItems = (o) =>
  o.items?.length
    ? o.items
    : [
        {
          _id: "legacy",
          product: o.product,
          quantity: o.quantity,
          productCents: o.productCents,
          snapshot: o.productSnapshot,
        },
      ];
export const itemId = (i) => String(i._id);
export async function reserveOrder(o, s) {
  const warehouses = await Warehouse.find({ active: true })
    .select("_id")
    .session(s);
  const shipments = await Shipment.find({ order: o.id }).session(s);
  for (const item of orderItems(o)) {
    const iid = itemId(item);
    const existing = await StockReservation.find({
      order: o.id,
      item: iid,
      status: "Active",
    }).session(s);
    const shipped = quantitySum(
      shipments
        .filter((x) => (x.item || "legacy") === iid)
        .map((x) => x.quantity),
    );
    let remaining = quantitySum([
      item.quantity,
      -shipped,
      -quantitySum(existing.map((x) => x.quantity)),
    ]);
    const batches = await Batch.find({
      product: item.product,
      warehouse: { $in: warehouses.map((w) => w._id) },
      condition: "Good",
      quantity: { $gt: 0 },
    })
      .sort({ createdAt: 1, _id: 1 })
      .session(s);
    for (const b of batches) {
      if (remaining <= 0) break;
      const take = Math.min(
        remaining,
        quantitySum([b.quantity, -(b.reservedQuantity || 0)]),
      );
      if (take <= 0) continue;
      b.reservedQuantity = quantitySum([b.reservedQuantity || 0, take]);
      await b.save({ session: s });
      await StockReservation.create(
        [{ order: o.id, item: iid, batch: b.id, quantity: take }],
        { session: s },
      );
      remaining = quantitySum([remaining, -take]);
    }
  }
}
export async function releaseReservations(order, s) {
  const rows = await StockReservation.find({ order, status: "Active" }).session(
    s,
  );
  for (const r of rows) {
    const b = await Batch.findById(r.batch).session(s);
    if (b) {
      b.reservedQuantity = quantitySum([b.reservedQuantity || 0, -r.quantity]);
      requireRule(b.reservedQuantity >= 0, "Reservation balance invalid");
      await b.save({ session: s });
    }
    r.status = "Released";
    await r.save({ session: s });
  }
}
export async function consumeReservation(order, item, batch, quantity, s) {
  const rows = await StockReservation.find({
    order,
    item,
    batch: batch.id,
    status: "Active",
  }).session(s);
  const own = quantitySum(rows.map((r) => r.quantity));
  requireRule(
    quantity <=
      quantitySum([batch.quantity, -(batch.reservedQuantity || 0), own]),
    "Stock reserved for another order",
  );
  let left = Math.min(quantity, own);
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.quantity, left);
    r.quantity = quantitySum([r.quantity, -take]);
    left = quantitySum([left, -take]);
    batch.reservedQuantity = quantitySum([batch.reservedQuantity || 0, -take]);
    if (!r.quantity) r.status = "Consumed";
    await r.save({ session: s });
  }
}
