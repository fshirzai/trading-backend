import { drawCompanyHeader } from "../settings/pdf-branding.service.js";
import { createHash, randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { Invoice } from "./invoices.model.js";
import {
  wrap,
  roles,
  ownOrder,
  entity,
  tx,
  audit,
} from "../../shared/services.js";
import { Order, Party } from "../../models.js";
import { requireRule } from "../../shared/rules.js";
import { orderItems } from "../inventory/reservations.service.js";
export function mountInvoices(app) {
  app.post(
    "/api/orders/:id/invoices",
    roles("admin", "manager", "seller"),
    wrap(async (req, res) =>
      res.status(201).json(
        await tx(async (s) => {
          const o = await ownOrder(req, req.params.id, s);
          requireRule(
            o.acceptedAt &&
              !["Refunded", "Return requested"].includes(o.status),
            "Accepted active order required",
          );
          const customer = await entity(Party, o.customer, s);
          const snapshot = {
            version: o.version,
            customer: {
              name: customer.name,
              address: customer.address,
              country: customer.country,
            },
            items: orderItems(o).map((i) => ({
              product: String(i.product),
              quantity: i.quantity,
              productCents: i.productCents,
              snapshot: i.snapshot,
            })),
            productCents: o.productCents,
            feesCents: o.feesCents,
            totalCents: o.totalCents,
            border: o.border,
            currency: "USD",
          };
          const fingerprint = createHash("sha256")
            .update(JSON.stringify(snapshot))
            .digest("hex");
          const prior = await Invoice.findOne({
            order: o.id,
            fingerprint,
          }).session(s);
          if (prior) return prior;
          const [invoice] = await Invoice.create(
            [
              {
                order: o.id,
                number: "INV-" + randomUUID().toUpperCase(),
                fingerprint,
                snapshot,
                issuedBy: req.user.id,
              },
            ],
            { session: s },
          );
          await audit(req, s, "invoice.issue", "Order", o.id, {
            invoice: invoice.id,
            number: invoice.number,
          });
          return invoice;
        }),
      ),
    ),
  );
  app.get(
    "/api/invoices/:id/pdf",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      const i = await entity(Invoice, req.params.id);
      await ownOrder(req, String(i.order));
      const snap = i.snapshot;
      const pdf = new PDFDocument({ size: "A4", margin: 45 });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${i.number}.pdf"`,
      });
      pdf.pipe(res);
      await drawCompanyHeader(pdf, req.appConfig);
      pdf.fontSize(16).text("Issued invoice");
      pdf
        .fontSize(10)
        .moveDown()
        .text(i.number)
        .text("Issued: " + i.createdAt.toISOString())
        .text("Customer: " + snap.customer.name)
        .text("Order: " + i.order)
        .text("Delivery: " + snap.border);
      for (const line of snap.items)
        pdf
          .moveDown()
          .text(
            (line.snapshot?.name?.en || "Product") +
              " - " +
              line.quantity +
              " " +
              (line.snapshot?.unit || "units"),
          )
          .text("USD " + (line.productCents / 100).toFixed(2));
      pdf
        .moveDown()
        .text("Delivery fees: USD " + (snap.feesCents / 100).toFixed(2))
        .text("Total: USD " + (snap.totalCents / 100).toFixed(2));
      pdf.end();
    }),
  );
}
