import { mountProformaPreview } from "./proforma-preview.routes.js";
import { commercialPdf } from "./commercial-pdf.service.js";
import { wrap, ownOrder, entity, roles } from "../../shared/services.js";
import { Party } from "../contacts/contacts.model.js";
import { requireRule } from "../../shared/rules.js";
export function mountGeneratedDocuments(app, config) {
  mountProformaPreview(app, config);
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
      const bytes = await commercialPdf({
        order: o,
        customer,
        type: req.params.type,
        config,
      });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${req.params.type}-${o.id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.send(bytes);
    }),
  );
}
