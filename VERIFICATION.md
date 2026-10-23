# Version 2.5 verification — 23 October 2026

Validation used isolated test fixtures and an ephemeral MongoDB replica set. No live customer database was seeded, and no repository was pushed or deployed.

## Automated checks

- Backend complete suite: **97 passed, 0 failed**. Includes all existing trading/security/accounting/inventory/payment/return/notification/backup tests and three new admin demo integration tests.
- Backend asset-path follow-up: **3 passed, 0 failed**, after changing seed image URLs to explicit local file references for deployment tracing.
- Frontend unit suite: **29 passed, 0 failed**. Includes matching keys across the centralized English/Pashto/Dari dictionary, home wording and five-role module access.
- Frontend React DOM interaction suite: **22 passed, 0 failed**, including administrator reauthentication/confirmation and the returned role-account list.
- Frontend API client against actual seeded backend over HTTP: **1 passed**.
- Development server and same-origin proxy system test: **1 passed**.
- Backend JavaScript syntax and Prettier formatting checks passed.
- Clean production builds in Vercel mode and static-export mode passed after the final frontend changes.

## New demo-data integration coverage

The tests verify default-disabled behavior, anonymous and non-admin rejection, strict confirmation, wrong administrator password rejection, account-collision rollback after partial transactional work, one-time creation, repeat-run protection, preservation of the existing administrator and its password hash, matching public WebP images/thumbnails, multilingual product names, two stock locations per product totalling 30 tonnes, balanced inventory/payables journal, exactly one creation audit, and login for all four new accounts. No password is returned in the seed summary.

Demo data is limited to users, parties, products/images, warehouses, purchases/receipts, stock batches/movements, quotation requests and a matching journal. It does not insert invented successful card payments or bypass quotation acceptance. All sample transactions affect the database's normal reports.

## Browser verification

Seven checks passed against the actual application/backend: administrator seed submission and resulting account list; settings-page layout at 320, 390 and 1440 pixels; and home wording plus catalog image loading in English, Pashto and Dari at 390 pixels. No horizontal overflow, uncaught browser exceptions, incorrect language direction or broken demo product images were detected. Product source images were inspected to confirm that beans, chickpeas and red lentils match their records.

The previous release's wider 108-layout matrix and 24 private-flow checks are retained as historical 2.4 evidence, not represented as newly rerun 2.5 checks.

## Language and configuration limits

Interface dictionaries now have one authoritative JSON file. Product names and company-edited content remain database records; user-entered text is not automatically translated. Saved custom About/policy content is retained. Company defaults apply when no custom content has been stored. Translation edits to source require rebuilding the frontend; editing content through System settings changes the database instead.

No live HesabPay settlement, merchant activation or production email configuration was tested during this update. The existing payment integration and its sandbox setup instructions are unchanged.
