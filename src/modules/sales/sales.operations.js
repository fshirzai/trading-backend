import mongoose from "mongoose";
import * as M from "../../models.js";
import {
  requireRule,
  cents,
  refundQuote,
  canDispatch,
  deliveryBalance,
  balanced,
  RuleError,
  quantitySum,
} from "../../shared/rules.js";
import {
  wrap,
  tx,
  audit,
  line,
  post,
  roles,
  manage,
  sales,
  procure,
  positive,
  id,
  entity,
  ownOrder,
  list,
  attachLabels,
} from "../../shared/services.js";
import { reserveOrder, orderItems } from "../inventory/reservations.service.js";
export function mountSalesOperations(app, config) {
  app.get(
    "/api/orders",
    wrap(async (req, res) => {
      let filter = {};
      if (req.user.role === "customer") {
        const p = await M.Party.findOne({ userId: req.user.id });
        filter.customer = p?._id || null;
      }
      res.json(await list(M.Order, filter, req.query));
    }),
  );

  app.get(
    "/api/orders/:id",
    wrap(async (req, res) => {
      const o = await ownOrder(req, req.params.id);
      const labeled = o.toObject();
      await attachLabels(M.Order, [labeled]);
      const internal = req.user.role !== "customer";
      res.json({
        order: labeled,
        invoices: await M.Invoice.find({ order: o.id })
          .select("number createdAt snapshot.totalCents order")
          .lean(),
        reservations: internal
          ? await M.StockReservation.find({ order: o.id, status: "Active" })
              .populate("batch", "warehouse location code")
              .lean()
          : [],
        procurementRequests: internal
          ? await M.ProcurementRequest.find({ order: o.id }).lean()
          : [],
        purchases:
          internal &&
          ["admin", "manager", "procurement"].includes(req.user.role)
            ? await M.Purchase.find({ order: o.id }).lean()
            : [],
        history: await M.Audit.find({
          $or: [{ entity: "Order", entityId: o.id }, { "details.order": o.id }],
        })
          .select(internal ? "" : "action createdAt entity")
          .sort({ createdAt: 1 })
          .lean(),
        shipments: await M.Shipment.find({ order: o.id })
          .select(
            req.user.role === "customer"
              ? "-costCents -allocations -acceptanceEvidence"
              : "",
          )
          .lean(),
        payments:
          req.user.role === "procurement"
            ? []
            : await M.Payment.find({ order: o.id }).lean(),
        returns: await M.Return.find({ order: o.id }).lean(),
      });
    }),
  );

  app.post(
    "/api/inquiries",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      let customer = req.body.customer;
      if (req.user.role === "customer") {
        const p = await M.Party.findOne({ userId: req.user.id });
        customer = p?.id;
      }
      const product = await entity(M.Product, req.body.product);
      const quantity = positive(req.body.quantity);
      requireRule(
        product.active && quantity >= (product.moq || 0),
        "Product unavailable or below minimum order",
      );
      const party = await entity(M.Party, customer);
      requireRule(party.type === "customer", "Customer party required");
      const out = await tx(async (s) => {
        const rows = req.body.items || [{ product: product.id, quantity }];
        requireRule(
          rows[0].product === product.id && rows[0].quantity === quantity,
          "Inquiry header must match first line",
        );
        requireRule(
          new Set(rows.map((x) => x.product)).size === rows.length,
          "Combine duplicate product lines",
        );
        const requested = [];
        for (const row of rows) {
          const p = await entity(M.Product, row.product, s);
          requireRule(
            p.active && row.quantity >= (p.moq || 0),
            "Product unavailable or below minimum order",
          );
          requested.push({ ...row, snapshot: { name: p.name, unit: p.unit } });
        }
        const [i] = await M.Inquiry.create(
          [
            {
              customer,
              items: requested,
              cartRequest: !!req.body.items,
              preferredPayment: req.body.preferredPayment,
              product: product.id,
              quantity,
              source:
                req.user.role === "customer" ? "website" : req.body.source,
              destination: req.body.destination,
            },
          ],
          { session: s },
        );
        await audit(req, s, "inquiry.create", "Inquiry", i.id);
        return i;
      });
      res.status(201).json(out);
    }),
  );

  app.get(
    "/api/inquiries",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const p =
        req.user.role === "customer"
          ? await M.Party.findOne({ userId: req.user.id })
          : null;
      res.json(
        await list(
          M.Inquiry,
          p
            ? { customer: p.id }
            : req.user.role === "customer"
              ? { customer: null }
              : {},
          req.query,
        ),
      );
    }),
  );

  app.post(
    "/api/inquiries/:id/proforma",
    sales,
    wrap(async (req, res) => {
      const out = await tx(async (s) => {
        const i = await entity(M.Inquiry, req.params.id, s);
        requireRule(i.status === "New", "Inquiry already quoted");
        const productCents = cents(req.body.productTotal),
          feesCents = req.body.deliveryFees ? cents(req.body.deliveryFees) : 0;
        requireRule(
          typeof req.body.border === "string" && req.body.border.trim(),
          "Border handover point required",
        );
        const product = await entity(M.Product, i.product, s);
        requireRule(product.active, "Product inactive");
        requireRule(
          !i.items?.length || i.items.length === 1 || req.body.items?.length,
          "Price every requested product line",
        );
        const items = [];
        for (const row of req.body.items || [
          {
            product: i.product,
            quantity: i.quantity,
            productTotal: req.body.productTotal,
          },
        ]) {
          const pr = await entity(M.Product, row.product, s);
          requireRule(
            pr.active && row.quantity >= (pr.moq || 0),
            "Product unavailable or below minimum order",
          );
          items.push({
            product: pr.id,
            quantity: row.quantity,
            productCents: cents(row.productTotal),
            snapshot: {
              name: pr.name,
              grade: pr.grade,
              origin: pr.origin,
              packaging: pr.packaging,
              unit: pr.unit,
            },
          });
        }
        requireRule(
          new Set(items.map((x) => String(x.product))).size === items.length,
          "Combine duplicate quotation products",
        );
        if (i.cartRequest && i.items?.length) {
          requireRule(
            items.length === i.items.length &&
              i.items.every((x) =>
                items.some(
                  (y) =>
                    String(y.product) === String(x.product) &&
                    y.quantity === x.quantity,
                ),
              ),
            "Quotation must cover requested products and quantities; revise the inquiry for changes",
          );
        }
        requireRule(
          items.reduce((n, x) => n + x.productCents, 0) === productCents,
          "Product total must equal sum of quotation lines",
        );
        const [o] = await M.Order.create(
          [
            {
              items,
              assignedTo: req.user.id,
              inquiry: i.id,
              customer: i.customer,
              product: i.product,
              productSnapshot: {
                name: product.name,
                grade: product.grade,
                origin: product.origin,
                packaging: product.packaging,
                unit: product.unit,
              },
              quantity: i.quantity,
              productCents,
              feesCents,
              totalCents: productCents + feesCents,
              border: req.body.border,
              returnHours: config.returnHours,
              splitIncluded: req.body.splitIncluded === true,
            },
          ],
          { session: s },
        );
        i.status = "Quoted";
        await i.save({ session: s });
        await audit(req, s, "proforma.issue", "Order", o.id);
        return o;
      });
      res.status(201).json(out);
    }),
  );

  app.post(
    "/api/orders/:id/accept",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      res.json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s);
          requireRule(!o.acceptedAt, "Proforma already accepted");
          if (req.user.role !== "customer")
            requireRule(
              typeof req.body.acceptanceEvidence === "string" &&
                req.body.acceptanceEvidence.trim(),
              "Record customer acceptance evidence",
            );
          o.acceptedAt = new Date();
          o.acceptedSnapshot = {
            items: orderItems(o).map((x) => (x.toObject ? x.toObject() : x)),
            acceptedBy: req.user.id,
            returnHours: o.returnHours,
            cancellationRetentionPercent: 25,
            product: o.product,
            productSnapshot: o.productSnapshot,
            splitIncluded: o.splitIncluded,
            quantity: o.quantity,
            productCents: o.productCents,
            feesCents: o.feesCents,
            totalCents: o.totalCents,
            border: o.border,
            version: o.version,
            evidence: req.body.acceptanceEvidence || "Customer portal",
          };
          o.status = "Deposit pending";
          await o.save({ session: s });
          await reserveOrder(o, s);
          await audit(req, s, "proforma.accept", "Order", o.id);
          return { order: o, paymentMethods: ["TT"], visaAvailable: false };
        }),
      );
    }),
  );
}
