import {
  Order,
  Party,
  Payment,
  Batch,
  User,
  Document,
  Inquiry,
  ProcurementRequest,
  Purchase,
  Warehouse,
} from "../../models.js";
import { wrap, manage, roles, list, ownOrder } from "../../shared/services.js";
export function mountWorkspace(app) {
  app.get(
    "/api/workspace/summary",
    wrap(async (req, res) => {
      if (req.user.role === "procurement") {
        const [requests, purchases, warehouses] = await Promise.all([
          ProcurementRequest.countDocuments({
            status: { $in: ["Requested", "Purchasing"] },
          }),
          Purchase.countDocuments({ status: "Ordered" }),
          Warehouse.countDocuments({ active: true }),
        ]);
        return res.json({
          scope: "Procurement workspace",
          procurement: { requests, purchases, warehouses },
          daily: [],
          stages: [],
          recent: [],
        });
      }
      const customer = req.user.role === "customer";
      const party = customer
        ? await Party.findOne({ userId: req.user.id }).select("_id").lean()
        : null;
      const match = customer ? { customer: party?._id || null } : {};
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 29);
      since.setUTCHours(0, 0, 0, 0);
      const [totals, stages, daily, recent, inquiries, inventory, pending] =
        await Promise.all([
          Order.aggregate([
            { $match: match },
            {
              $group: {
                _id: null,
                orders: { $sum: 1 },
                quantity: { $sum: "$quantity" },
                totalCents: { $sum: "$totalCents" },
                paidCents: { $sum: "$paidCents" },
                refundedCents: { $sum: "$refundedCents" },
                outstandingCents: {
                  $sum: {
                    $cond: [
                      {
                        $in: [
                          "$status",
                          ["Refunded", "Delivered", "Cancelled"],
                        ],
                      },
                      0,
                      {
                        $max: [0, { $subtract: ["$totalCents", "$paidCents"] }],
                      },
                    ],
                  },
                },
              },
            },
          ]).option({ maxTimeMS: 5000 }),
          Order.aggregate([
            { $match: match },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ]).option({ maxTimeMS: 5000 }),
          Order.aggregate([
            { $match: { ...match, createdAt: { $gte: since } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$createdAt",
                    timezone: "UTC",
                  },
                },
                orders: { $sum: 1 },
                valueCents: { $sum: "$totalCents" },
              },
            },
            { $sort: { _id: 1 } },
          ]).option({ maxTimeMS: 5000 }),
          list(Order, match, { limit: "5" }),
          Inquiry.countDocuments({ ...match, status: "New" }).maxTimeMS(5000),
          customer
            ? null
            : Batch.aggregate([
                {
                  $group: {
                    _id: null,
                    quantity: { $sum: "$quantity" },
                    valueCents: { $sum: "$valueCents" },
                    batches: { $sum: 1 },
                  },
                },
              ]).option({ maxTimeMS: 5000 }),
          customer || req.user.role === "procurement"
            ? null
            : Payment.countDocuments({ status: "Pending" }).maxTimeMS(5000),
        ]);
      res.json({
        currency: "USD",
        generatedAt: new Date(),
        scope: customer ? "Your orders" : "Company orders",
        totals: totals[0] || {
          orders: 0,
          quantity: 0,
          totalCents: 0,
          paidCents: 0,
          refundedCents: 0,
          outstandingCents: 0,
        },
        stages,
        daily,
        recent: recent.items,
        newInquiries: inquiries,
        inventory: inventory?.[0] || null,
        pendingPayments: pending,
      });
    }),
  );
  app.get(
    "/api/users",
    manage,
    wrap(async (req, res) => {
      const filter =
        req.user.role === "manager"
          ? { role: { $in: ["seller", "procurement"] } }
          : {};
      res.json(
        await list(User, filter, req.query, {
          select:
            "name email role active emailVerified mfaEnabled createdAt updatedAt",
        }),
      );
    }),
  );
  app.get(
    "/api/orders/:id/documents",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const order = await ownOrder(req, req.params.id);
      res.json(
        await list(Document, { order: order.id }, req.query, {
          select:
            "name kind mime size status normalized createdAt updatedAt order",
        }),
      );
    }),
  );
}
