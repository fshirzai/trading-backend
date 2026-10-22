import mongoose from "mongoose";
import * as M from "../../models.js";
import {
  wrap,
  roles,
  tx,
  ownOrder,
  audit,
  list,
  entity,
} from "../../shared/services.js";
import { requireRule, quantitySum } from "../../shared/rules.js";
import { reserveOrder, orderItems, itemId } from "./reservations.service.js";
const staff = roles("admin", "manager", "seller", "procurement");
export function mountStock(app) {
  app.get(
    "/api/stock/summary",
    staff,
    wrap(async (req, res) => {
      const match = {};
      if (req.query.warehouse)
        match.warehouse = new mongoose.Types.ObjectId(req.query.warehouse);
      if (req.query.product)
        match.product = new mongoose.Types.ObjectId(req.query.product);
      const groups = await M.Batch.aggregate([
        { $match: match },
        {
          $group: {
            _id: { product: "$product", warehouse: "$warehouse" },
            quantity: { $sum: "$quantity" },
            reserved: { $sum: { $ifNull: ["$reservedQuantity", 0] } },
            sellable: {
              $sum: {
                $cond: [{ $eq: ["$condition", "Good"] }, "$quantity", 0],
              },
            },
          },
        },
      ]).option({ maxTimeMS: 5000 });
      const products = await M.Product.find({
        _id: { $in: groups.map((g) => g._id.product) },
      }).lean();
      const warehouses = await M.Warehouse.find({
        _id: { $in: groups.map((g) => g._id.warehouse) },
      }).lean();
      let rows = products
        .map((p) => {
          const locations = groups
            .filter((g) => String(g._id.product) === String(p._id))
            .map((g) => ({
              warehouse: String(g._id.warehouse),
              name:
                warehouses.find(
                  (w) => String(w._id) === String(g._id.warehouse),
                )?.name || "Warehouse",
              quantity: g.quantity,
              reserved: g.reserved,
              available: quantitySum([g.sellable, -g.reserved]),
              quarantined: quantitySum([g.quantity, -g.sellable]),
            }));
          return {
            ...p,
            quantity: quantitySum(locations.map((l) => l.quantity)),
            reserved: quantitySum(locations.map((l) => l.reserved)),
            available: quantitySum(locations.map((l) => l.available)),
            locations,
          };
        })
        .sort((a, b) => String(b._id).localeCompare(String(a._id)));
      if (req.query.search) {
        const q = req.query.search.toLowerCase();
        rows = rows.filter((r) =>
          JSON.stringify([
            r.name,
            r.category,
            r.grade,
            r.locations.map((l) => l.name),
          ])
            .toLowerCase()
            .includes(q),
        );
      }
      if (req.query.cursor)
        rows = rows.filter((r) => String(r._id) < req.query.cursor);
      const limit = Number(req.query.limit || 25);
      const more = rows.length > limit;
      rows = rows.slice(0, limit);
      res.json({
        items: rows,
        nextCursor: more ? String(rows.at(-1)._id) : null,
      });
    }),
  );
  app.post(
    "/api/orders/:id/reserve",
    roles("admin", "manager", "seller", "procurement"),
    wrap(async (req, res) =>
      res.json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s);
          requireRule(
            o.acceptedAt &&
              !["Return requested", "Refunded"].includes(o.status),
            "Order cannot reserve stock",
          );
          await reserveOrder(o, s);
          o.markModified("updatedAt");
          await o.save({ session: s });
          await audit(req, s, "stock.reserve", "Order", o.id);
          return {
            reservations: await M.StockReservation.find({
              order: o.id,
              status: "Active",
            }).session(s),
          };
        }),
      ),
    ),
  );
  app.get(
    "/api/procurement-requests",
    staff,
    wrap(async (req, res) =>
      res.json(await list(M.ProcurementRequest, {}, req.query)),
    ),
  );
  app.post(
    "/api/orders/:id/procurement-requests",
    roles("admin", "manager", "seller"),
    wrap(async (req, res) =>
      res.status(201).json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s);
          requireRule(
            o.acceptedAt &&
              !["Return requested", "Refunded", "Delivered"].includes(o.status),
            "Accepted open order required",
          );
          await reserveOrder(o, s);
          const item = orderItems(o).find(
            (i) => itemId(i) === (req.body.item || itemId(orderItems(o)[0])),
          );
          requireRule(item, "Order item not found");
          const reservations = await M.StockReservation.find({
            order: o.id,
            item: itemId(item),
            status: "Active",
          }).session(s);
          const shipments = await M.Shipment.find({ order: o.id }).session(s);
          const shortage = quantitySum([
            item.quantity,
            -quantitySum(reservations.map((r) => r.quantity)),
            -quantitySum(
              shipments
                .filter((x) => (x.item || "legacy") === itemId(item))
                .map((x) => x.quantity),
            ),
          ]);
          requireRule(shortage > 0, "No stock shortage for this item");
          requireRule(
            !(await M.ProcurementRequest.exists({
              order: o.id,
              item: itemId(item),
              status: { $in: ["Requested", "Purchasing"] },
            }).session(s)),
            "Open procurement request already exists",
          );
          const [r] = await M.ProcurementRequest.create(
            [
              {
                order: o.id,
                item: itemId(item),
                product: item.product,
                quantity: shortage,
                requestedBy: req.user.id,
                note: req.body.note,
              },
            ],
            { session: s },
          );
          await o.save({ session: s });
          await audit(
            req,
            s,
            "procurement.request",
            "ProcurementRequest",
            r.id,
          );
          return r;
        }),
      ),
    ),
  );
}
