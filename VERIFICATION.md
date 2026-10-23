# Version 2.6.1 verification — 23 October 2026

All checks used isolated fixtures or ephemeral MongoDB replica sets. No live database, GitHub repository or deployment was modified.

## Automated results

- Complete backend suite: **105 passed, 0 failed**.
- Focused proforma integration suite: **7 passed, 0 failed** (also included in the full suite). Two new cases verify read-only issue/revision previews, valid PDF responses, unchanged order/inquiry/version/history, invalid packaging/unknown-field rejection and customer exclusion from staff draft routes.
- Frontend unit tests: **30 passed, 0 failed**.
- Frontend UI tests: **28 passed, 0 failed**. New cases cover preview-before-save, retained form values, automatic saved-document view, PDF download links, print invocation, retry/error handling, object-URL cleanup and owning-customer issued-invoice controls.
- Frontend API client against the actual backend: **1 passed**.
- Development entry/proxy system test: **1 passed**.
- Backend syntax and formatting checks passed.
- Static-export and Vercel-mode production builds passed. A final Dari wording correction affects one new explanatory sentence; the Vercel-mode build includes that correction.
- No dependencies were added. Non-root package-lock entries remain identical to 2.6.

## Live browser fixture

Seven checks passed using Chromium against the built frontend, real backend and a temporary seeded database:

1. Grouped quotation editor fits 390px width.
2. Grouped quotation editor fits 1440px width.
3. Manager previews an authenticated, generated draft without creating an order.
4. Saving creates one order, stores the packaging and opens the saved proforma.
5. Staff downloads a valid PDF from the in-app viewer.
6. The owning customer's viewer fits the tested mobile viewport.
7. The customer opens and downloads their own saved proforma.

No uncaught page exceptions or frame-policy errors were observed. Browser screenshots were used for internal layout review only and are excluded from the deliverable.

The browser-downloaded draft and saved PDFs were checked for actual PDF bytes. Poppler extraction confirms the same reference, 1,000 bags × 25 kg, 25 tonnes, USD 22,000 and Ghazni shipping details. Only the unsaved draft carries the UNSAVED DRAFT mark. The one-page draft was rendered and visually inspected for its four header panels, goods table, totals, amount in words, bank details, terms and signature block.

## Scope and limits

The screen viewer, print action and download link share the authenticated generated PDF bytes; they do not maintain separate HTML and PDF invoice templates. The browser's embedded PDF viewer and native printer dialog depend on device support. Print invocation is covered by the UI test; no physical printer was used. New-tab and download fallbacks are provided for devices without embedded viewing.

The 2.6 full multilingual browser matrices remain historical evidence under verification-2.6. The new form/viewer was checked at the widths listed above; it was not claimed to repeat every earlier page/language matrix. The central dictionary now has 963 matching keys per language. Existing permissions, transaction protections, financial rules and issued invoice snapshots remain in force. Live Vercel, SMTP and HesabPay settlement were not exercised.
