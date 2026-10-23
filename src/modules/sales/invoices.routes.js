import { commercialPdf } from "../documents/commercial-pdf.service.js";
import { createHash, randomUUID } from "node:crypto";
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
            quotationDocument: o.quotationDocument,
            returnHours: o.returnHours,
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
      const bytes = await commercialPdf({
        order: { ...i.snapshot, id: String(i.order), createdAt: i.createdAt },
        customer: i.snapshot.customer,
        type: "invoice",
        invoice: i,
        config: req.appConfig,
      });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${i.number}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.send(bytes);
    }),
  );
}
