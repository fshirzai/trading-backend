# Trading Company 2.6 — Proforma documents and frontend languages

This package contains the complete backend and frontend source, including the earlier payment-methods configuration fix. It has not been pushed or deployed. Preserve your environment files and existing DATA_ENCRYPTION_KEY. No database reset or demo reseeding is required.

## Proforma design

The PDF follows the supplied reference's structure:

- Seller/exporter and proforma details in the first row.
- Buyer/importer and shipping/delivery in the second row.
- Numbered goods table: quantity/unit/packaging, description, unit price in USD, line total and remarks.
- Product value, delivery fees and total amount.
- Amount in words, bank instructions, notes/conditions and an authorized signature/stamp area.
- A proforma-not-final-invoice footer, version and page numbering.

The normal sample fits one A4 page. Longer orders continue across pages with repeated goods-table headings. The supplied preview uses illustrative buyer and bank details, not a real payment destination. PDFs use bundled fonts and preserve customer document permissions. The original reference is not copied into this package.

### Set the seller and bank information

Administrator → **System settings → Invoice seller and bank details**:

1. Enter company registration number and tax/TIN number.
2. Enter bank name, account name, account number/IBAN, SWIFT and payment instructions.
3. Set authorized signatory name and position.
4. Save settings. The existing company name, address, telephone and email fields supply the seller's contact details.

These bank details are private settings. They are excluded from `/api/settings/public` and are never added to the public branding state. They are copied into new quotations and their customer documents. Changing a bank setting later does not rewrite the bank details saved on an existing quote. Updating About photos also preserves the administrator's invoice profile.

The PDF bank section is for bank-transfer instructions. It does not change the receiving HesabPay merchant; that account continues to be configured separately through the existing merchant settings.

### Create a proforma

In **Inquiries**, select **Issue quotation**:

1. Check every product and its quantity. Line totals are in USD; the unit price is calculated from the line total and quantity. The form's product total is the sum of its lines.
2. Set **Packaging** on each line. Leaving it empty uses the product's existing packaging.
3. If bags are used, set both **Bag Count** and **Bag Weight Kg**. For products measured in kg or tonne, the backend verifies that their total weight matches the quoted quantity. For example, 1,000 bags × 25 kg = 25,000 kg = 25 tonnes. An inconsistent bag plan is rejected. Additional explanations can go in **Remarks**.
4. Expand/use **Quotation Details** for the optional reference, issue/valid-until dates, delivery terms/Incoterms, loading place, transport, delivery address, country of origin, instructions, notes and buyer contact/registration/tax fields.
5. The buyer's name/address/phone/email come from its customer party record. Maintain these through Customers & suppliers. The quote captures them when issued.
6. Review delivery fees, destination and split-delivery terms, then issue the quotation.

A supplied reference must be unique, at most 60 characters, using letters, digits, dot, slash, underscore or hyphen. If it is omitted, the PDF uses the unique order ID as its reference. Dates use Gregorian YYYY-MM-DD. A valid-until date cannot precede the issue date. A quote with an expired valid-until date cannot be accepted until staff issues a revision. If validity is omitted, the document displays "As agreed".

Bag weights and packaging are order-specific snapshots, so changing a catalog product later does not change them. Revisions save the previous details in approval/history. Customer acceptance saves the extended proforma details in the accepted snapshot. Issued invoices also keep a snapshot, so later settings edits cannot rewrite their bank and trade details.

### Customer documents

Customer → Orders → open own order → **Documents → Proforma PDF**. Issued invoices and packing lists use the same document renderer. Other customers cannot download that order's PDF. The application finishes rendering the PDF before sending response headers, avoiding a half-sent download when rendering fails.

Orders created before 2.6 remain usable. They show their available legacy product/party data and current company defaults where an old document has no saved company snapshot. New quote-only fields are not invented for historical records; revise an eligible unpaid quote to capture them.

### Business rules retained

The reference PDF is a visual/data reference. Its sample 100% prepayment wording has not replaced the established system rule: dispatch requires 50% of product value, with the balance at handover. The form preview now uses product value, excluding delivery fees, for this deposit calculation. Cancellation before dispatch refunds verified money paid; after dispatch the retained charge remains 25% of order total. Return-window and inspection rules are retained. Free-text Incoterms, notes and bank instructions do not silently change these workflow rules.

## Frontend languages

All interface translations remain in **trading-frontend/src/shared/locales/messages.json**, under `en`, `ps` and `fa`. Edit values, keep keys, save as UTF-8 and rebuild the frontend. Product names and administrator-edited company content remain MongoDB data and are not automatically translated or overwritten.

This update reviews the public pages, dashboard/navigation, staff forms, stock/media, customer orders/documents, receipts, profile/security, notifications, reports and settings. It also fixes untranslated multi-line JSX text, shared buttons/statuses, form hints, table headers and document buttons. Static interface text has a coverage inventory; dynamic company names, product data, references and technical identifiers are intentionally treated as data.

Familiar terms are used where literal translations sound awkward:

| English | Pashto | Dari |
| --- | --- | --- |
| Dashboard | ډاشبورډ | داشبورد |
| Profile | پروفایل | پروفایل |
| Proforma | پروفارما | پروفارما |
| Invoice | انوایس | انوایس |
| Upload | اپلوډ | بارگذاری |
| Download | ډاونلوډ | دانلود |
| Stock | سټاک | موجودی |

Common dates in the UI use a numeric Gregorian format rather than English month names. English/technical identifiers such as PDF, CSV, account references and commands stay readable. Pashto/Dari use the bundled Arabic-script font and right-to-left layout. Existing company-edited About and policy text is preserved: change it in System settings if you want to revise that text too.

## Deploy

1. Back up your database using your normal backup process.
2. Copy both source folders into your existing checkouts, preserving real `.env` / `.env.local` files and your encryption key.
3. Run `npm ci` in both projects.
4. Backend: `npm run check`, `npm run format:check`, `npm test`.
5. Frontend: `npm test`, `npm run test:ui`, `npm run test:integration`, `npm run test:dev`, `npm run build`.
6. Deploy the backend first, then the frontend. No new environment variables are required for this upgrade. Keep DEMO_DATA_ENABLED disabled when not adding sample data.
7. Fill your actual invoice company/bank details in System settings, issue a sample quotation, review packaging and totals, then download it from a customer account.

All document/font assets are inside backend `src`, copied by the existing Dockerfile and referenced by explicit local URLs for serverless tracing. No new npm dependencies were added. See VERIFICATION_2.6.md and the verification logs for the tested scope.
