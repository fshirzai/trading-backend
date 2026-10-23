# Version 2.4 verification — 23 October 2026

This report covers the packaged source and isolated local fixtures. It is not a claim that the user's live merchant account, SMTP service or deployed environment has been tested.

## Automated checks

- Backend complete suite: 94 passed, 0 failed. Includes the existing trading, security, accounting, stock, refunds, files, notifications, backups and migration tests, plus commerce integration coverage.
- Follow-up profile/content/commerce integration suite: 11 passed, including default About content for an existing blank configuration.
- Frontend unit suite: 27 passed, including cart sanitization, exact AFN minor-unit conversion, current contracts and trusted PUT/revision-header proxy forwarding.
- Frontend React DOM interaction suite: 21 passed, including filtering, multi-product cart submission, starter content, named inquiry lines and a regression test for delayed anonymous session restoration after successful sign-in.
- Actual frontend API client against seeded backend over HTTP: 1 passed.
- Development server and same-origin proxy system test: 1 passed.
- Backend syntax and formatting checks passed.
- Clean static-export production build and Vercel-mode production build passed. Build output has separate Home, Products, Product, Cart, About, Contact, Terms, Privacy and Delivery pages.

## Browser checks

The public page layout matrix uses Chromium and controlled catalog fixtures: 9 routes × 4 widths (320, 390, 768, 1440 pixels) × 3 languages = 108 checks. No horizontal overflow, uncaught browser errors or incorrect reading direction were found. Pashto/Dari pages use the bundled Arabic-script font. Screenshots were inspected internally to check font rendering and layout.

The separate private browser report contains 24 successful checks against an ephemeral seeded MongoDB replica set: real guest-to-customer multi-product request submission; 20 workspace checks across mobile and desktop; admin merchant settings and About-photo upload; private profile-photo upload; and session restoration after reload. No overflow or uncaught browser errors were found. No production data or real merchant key is used.

## HesabPay checks

API adapter tests use controlled responses for the documented create-session and verify-signature endpoints. They cover merchant-only settings access, encrypted key storage/redaction, stale revisions, callback stability across rate updates, exact AFN quotation, idempotent checkout creation, invalid signatures, wrong amounts, and repeated notifications without duplicate ledger postings. Order payments preserve USD amounts and their AFN conversion snapshots.

Live card acceptance, merchant activation, provider-side webhook registration and actual settlement require the company's own sandbox/merchant testing. No undocumented automatic HesabPay refund endpoint is used.

## Reliability improvements

The local proxy now allows trusted administrator PUT requests and forwards settings revision headers. It serves bundled image/font MIME types. Production builds clear generated output so older route caches cannot serve earlier page assets. Optional array fields no longer create mandatory-looking rows. A late guest session-restore failure cannot override a successful login. The order-list card action opens the configured HesabPay confirmation; fully paid orders do not offer another checkout.

No backend dependencies were added. Product/cart quantities and prices remain server-validated; the cart does not bypass quotation acceptance or stock reservation. Backend/frontend package versions are 2.4.0.
