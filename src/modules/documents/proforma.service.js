import { SystemSettings } from "../settings/settings.model.js";
import { requireRule } from "../../shared/rules.js";
export function quoteLineSnapshot(product, row) {
  const paired = row.bagCount !== undefined || row.bagWeightKg !== undefined;
  if (paired) {
    requireRule(
      row.bagCount !== undefined && row.bagWeightKg !== undefined,
      "Provide both bag count and weight per bag",
    );
    const multiplier =
      product.unit === "tonne" ? 1000 : product.unit === "kg" ? 1 : null;
    requireRule(
      multiplier !== null,
      "Bag weights require a product measured in kg or tonne",
    );
    requireRule(
      Math.abs(row.bagCount * row.bagWeightKg - row.quantity * multiplier) <
        0.001,
      "Bag count and weight must match the quoted quantity",
    );
  }
  return {
    name: product.name,
    grade: product.grade,
    origin: product.origin,
    unit: product.unit,
    packaging: row.packaging?.trim() || product.packaging,
    bagCount: row.bagCount,
    bagWeightKg: row.bagWeightKg,
    remarks: row.remarks,
  };
}
export async function quotationDocument(
  customer,
  details = {},
  session,
  config = {},
) {
  const settings = await SystemSettings.findById("company")
    .session(session || null)
    .lean();
  const profile = settings?.invoiceProfile || {};
  const issueDate = details.issueDate || new Date().toISOString().slice(0, 10);
  requireRule(
    !details.validUntil || details.validUntil >= issueDate,
    "Valid-until date must not precede the issue date",
  );
  return {
    ...details,
    reference: details.reference?.trim() || undefined,
    issueDate,
    seller: {
      name: settings?.name || config.emailBrandName || "Trading Company",
      address: settings?.address || "",
      phone: settings?.contactPhone || "",
      email: settings?.contactEmail || "",
      registrationNo: profile.registrationNo || "",
      taxNo: profile.taxNo || "",
    },
    buyer: {
      name: customer.name,
      address: customer.address || "",
      country: customer.country || "",
      phone: customer.phone || "",
      email: customer.email || "",
      contact: details.buyerContact || "",
      registrationNo: details.buyerRegistrationNo || "",
      taxNo: details.buyerTaxNo || "",
    },
    bank: {
      name: profile.bankName || "",
      accountName: profile.accountName || "",
      accountNumber: profile.accountNumber || "",
      swiftCode: profile.swiftCode || "",
      instructions:
        details.paymentInstructions || profile.paymentInstructions || "",
    },
    signatory: {
      name: profile.signatoryName || "",
      position: profile.signatoryPosition || "",
    },
  };
}
