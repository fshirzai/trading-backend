import PDFDocument from "pdfkit";
import { wrap, ownOrder, entity, roles } from "../../shared/services.js";
import { Party } from "../contacts/contacts.model.js";
import { Shipment } from "../logistics/logistics.model.js";
import { requireRule } from "../../shared/rules.js";
export function mountGeneratedDocuments(app, config) {
  app.get(
    "/api/orders/:id/documents/:type.pdf",
    roles("admin", "manager", "seller", "customer"),
    wrap(async (req, res) => {
      requireRule(
        ["proforma", "invoice", "packing-list"].includes(req.params.type),
        "Unknown document type",
      );
      const o = await ownOrder(req, req.params.id),
        customer = await entity(Party, o.customer);
      if (req.params.type === "invoice")
        requireRule(o.acceptedAt, "Accepted order required");
      const pdf = new PDFDocument({ size: "A4", margin: 45 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${req.params.type}-${o.id}.pdf"`,
      );
      pdf.pipe(res);
      pdf.fontSize(24).text("Trading Company");
      pdf.fontSize(16).text(req.params.type.toUpperCase());
      pdf
        .moveDown()
        .fontSize(10)
        .text("Order: " + o.id + " | Version " + o.version)
        .text("Customer: " + customer.name)
        .text("Border handover: " + o.border);
      pdf
        .moveDown()
        .text("Product: " + (o.productSnapshot?.name?.en || "Product"))
        .text("Grade: " + (o.productSnapshot?.grade || "Agreed grade"))
        .text("Quantity: " + o.quantity + " tonnes")
        .text("Packaging: " + (o.productSnapshot?.packaging || "As agreed"));
      if (req.params.type !== "packing-list") {
        pdf
          .moveDown()
          .text("Product value: USD " + (o.productCents / 100).toFixed(2))
          .text("Delivery fees: USD " + (o.feesCents / 100).toFixed(2))
          .text("Total: USD " + (o.totalCents / 100).toFixed(2))
          .text("Verified paid: USD " + (o.paidCents / 100).toFixed(2))
          .text(
            "Remaining: USD " + ((o.totalCents - o.paidCents) / 100).toFixed(2),
          );
        pdf
          .moveDown()
          .text(
            "50% product deposit before dispatch; proportional balance at border delivery. Return request window: " +
              o.returnHours +
              " hours. After dispatch retain 25% of total; return transport included.",
          );
      }
      pdf
        .moveDown()
        .fontSize(8)
        .text(
          "Generated " +
            new Date().toISOString() +
            ". This document reflects recorded commercial terms.",
        );
      pdf.end();
    }),
  );
}
