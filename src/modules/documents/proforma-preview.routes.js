import { commercialPdf } from "./commercial-pdf.service.js";
import { quotationDocument, quoteLineSnapshot } from "./proforma.service.js";
import { Inquiry, Product, Party, Payment, Shipment } from "../../models.js";
import { wrap, roles, entity, ownOrder } from "../../shared/services.js";
import { cents, requireRule } from "../../shared/rules.js";

// Read-only draft rendering. Issuing/revising still goes through the transactional sales routes.
export function mountProformaPreview(app, config) {
  for (const revision of [false, true]) {
    app.post(
      revision
        ? "/api/orders/:id/revise/preview"
        : "/api/inquiries/:id/proforma/preview",
      roles("admin", "manager", "seller"),
      wrap(async (req, res) => {
        const source = revision
          ? await ownOrder(req, req.params.id)
          : await entity(Inquiry, req.params.id);
        if (revision) {
          requireRule(
            source.paidCents === 0 &&
              !(await Payment.exists({ order: source.id })) &&
              !(await Shipment.exists({ order: source.id })),
            "Cannot revise after a payment submission or dispatch",
          );
          requireRule(
            !["Refunded", "Return requested"].includes(source.status),
            "Order closed",
          );
        } else requireRule(source.status === "New", "Inquiry already quoted");
        const body = req.body;
        requireRule(
          !source.items?.length ||
            source.items.length === 1 ||
            body.items?.length,
          "Price every requested product line",
        );
        const items = [];
        for (const row of body.items || [
          {
            product: source.product,
            quantity: source.quantity,
            productTotal: body.productTotal,
            ...(revision
              ? source.items?.[0]?.snapshot?.toObject?.() ||
                source.items?.[0]?.snapshot ||
                {}
              : {}),
          },
        ]) {
          const product = await entity(Product, row.product);
          requireRule(
            product.active && row.quantity >= (product.moq || 0),
            "Product unavailable or below minimum order",
          );
          items.push({
            product: product.id,
            quantity: row.quantity,
            productCents: cents(row.productTotal),
            snapshot: quoteLineSnapshot(product, row),
          });
        }
        requireRule(
          new Set(items.map((i) => i.product)).size === items.length,
          "Combine duplicate quotation products",
        );
        if (!revision && source.cartRequest && source.items?.length) {
          requireRule(
            items.length === source.items.length &&
              source.items.every((x) =>
                items.some(
                  (y) =>
                    y.product === String(x.product) &&
                    y.quantity === x.quantity,
                ),
              ),
            "Quotation must cover requested products and quantities; revise the inquiry for changes",
          );
        }
        const productCents = cents(body.productTotal),
          feesCents = body.deliveryFees ? cents(body.deliveryFees) : 0;
        requireRule(
          items.reduce((n, i) => n + i.productCents, 0) === productCents,
          "Product total must equal sum of quotation lines",
        );
        const customer = await entity(Party, source.customer);
        const terms =
          revision && !body.quotationDetails
            ? source.quotationDocument
            : await quotationDocument(
                customer,
                {
                  ...(revision ? source.quotationDocument || {} : {}),
                  ...body.quotationDetails,
                },
                null,
                config,
              );
        const bytes = await commercialPdf({
          order: {
            id: source.id,
            createdAt: source.createdAt,
            items,
            quotationDocument: terms,
            productCents,
            feesCents,
            totalCents: productCents + feesCents,
            border: body.border,
            splitIncluded: body.splitIncluded,
            returnHours: source.returnHours || config.returnHours,
            version: revision ? source.version + 1 : 1,
          },
          customer,
          config,
          draft: true,
        });
        res.set({
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="draft-proforma.pdf"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.send(bytes);
      }),
    );
  }
}
