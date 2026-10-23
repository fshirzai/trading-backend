# Trading MIS 2.6.1 — proforma create, preview, view, print and download

This is a complete backend/frontend source release, including 2.6 changes. It adds the invoice layout to the working application rather than supplying only an example PDF.

## Staff workflow

1. In **Admin → System settings → Invoice seller and bank details**, save the real company, registration, bank and authorized-signatory information.
2. Open **Inquiries → Actions → Issue quotation**. The editor groups invoice reference/dates, buyer contact/tax data, shipping details, goods/packaging and totals.
3. Enter each product quantity and line total. Packaging is editable for this quotation. When using bag counts and kilograms per bag, supply both; their combined weight must equal the quoted quantity. Total product value is the sum of all lines; dispatch deposit remains 50% of product value.
4. Choose **Preview document** to render an explicitly marked, unsaved draft. It does not create an order or change the inquiry. Close the preview to continue editing; entered values remain.
5. Choose **Issue quotation**. The saved proforma opens immediately inside the system with **Print**, **Download PDF** and **Open in new tab**.
6. Reopen it under **Orders → View all → View / print proforma**, or under the order's **Documents** tab.
7. For an eligible quotation, use **Revise quotation**. The same editor and draft preview are available. Saving generates the updated proforma and preserves the prior version in history. Payment/dispatch restrictions and customer reacceptance rules remain enforced.

## Customer and commercial invoices

Customers open their own orders and choose **View / print proforma**. Their PDF download uses the same server renderer, saved values, packaging and layout as staff viewing and printing.

For accepted orders, authorized staff can **Issue invoice** from the Documents tab. Issued invoices have **View / print invoice** and **Download issued invoice** controls for staff and the owning customer. These use the issued invoice's immutable snapshot. Revising an eligible quotation changes its current proforma; it does not rewrite an already issued financial invoice. The existing recorded-order invoice and packing-list downloads also use the same commercial layout.

The document viewer loads private PDF bytes through the authenticated API, then creates a temporary browser object URL. It releases the URL when closed. No invoice file or public document link is stored in localStorage. On devices without an embedded PDF viewer, use **Open in new tab** or **Download PDF**, then the device's PDF print command. Printer availability and native print dialogs depend on the browser/device.

## Deploy

- Update both existing repositories with their corresponding folder contents and commit/push through your normal workflow. Preserve existing environment variables, encryption keys and secrets. Do not upload node_modules, out or .next.
- Deploy the backend first, then rebuild/deploy the frontend. Both releases are needed for the new draft preview endpoints.
- There are no new dependencies, environment variables, seed requirements or destructive database migrations.
- Existing proformas, business rules, optional MFA, payment integrations and order ownership checks remain in effect.
- Test with a staff quotation and its own customer account after deployment. A local verification report is included; live Vercel/SMTP/merchant settlement was not exercised.
