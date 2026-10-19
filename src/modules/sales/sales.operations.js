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
      res.json({
        order: labeled,
        shipments: await M.Shipment.find({ order: o.id })
          .select(
            req.user.role === "customer"
              ? "-costCents -allocations -acceptanceEvidence"
              : "",
          )
          .lean(),
        payments: await M.Payment.find({ order: o.id }).lean(),
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
        const [i] = await M.Inquiry.create(
          [
            {
              customer,
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
        const [o] = await M.Order.create(
          [
            {
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
          await audit(req, s, "proforma.accept", "Order", o.id);
          return { order: o, paymentMethods: ["TT"], visaAvailable: false };
        }),
      );
    }),
  );
}
