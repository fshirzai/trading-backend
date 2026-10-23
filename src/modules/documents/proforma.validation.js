import { z } from "zod";
import { strict, qty } from "../../shared/validation.js";
const field = (max) => z.string().trim().max(max).optional();
export const invoiceProfileSchema = strict({
  registrationNo: field(100),
  taxNo: field(100),
  bankName: field(200),
  accountName: field(200),
  accountNumber: field(120),
  swiftCode: field(80),
  paymentInstructions: field(1000),
  signatoryName: field(200),
  signatoryPosition: field(120),
});
export const quotationDetailsSchema = strict({
  reference: z
    .string()
    .trim()
    .max(60)
    .regex(/^[A-Za-z0-9./_-]*$/)
    .optional(),
  issueDate: z.string().date().optional(),
  validUntil: z.string().date().optional(),
  deliveryTerms: field(160),
  loadingPlace: field(200),
  transport: field(120),
  deliveryAddress: field(500),
  origin: field(120),
  instructions: field(1000),
  notes: field(2000),
  buyerContact: field(200),
  buyerRegistrationNo: field(100),
  buyerTaxNo: field(100),
  paymentInstructions: field(1000),
}).refine((v) => !v.validUntil || !v.issueDate || v.validUntil >= v.issueDate, {
  message: "Valid-until date must not precede the issue date",
  path: ["validUntil"],
});
export const packagingFields = {
  packaging: field(200),
  bagCount: z.number().int().positive().max(10000000).optional(),
  bagWeightKg: qty.optional(),
  remarks: field(500),
};
