# Backend API

Base URL: `http://localhost:4000/api`. JSON except document upload/download. All paths below are relative to the base URL.

## Authentication

`POST /auth/register`: `name,email,password,country?`; always creates Customer. Never accepts a role.

`POST /auth/login`: `email,password`; returns `{accessToken,expiresIn:900,user}` and sets refresh cookie. Use `Authorization: Bearer <accessToken>` for protected endpoints. Keep the access token in frontend memory; send credentials/cookies for refresh. `POST /auth/refresh` needs the cookie and an exact allowed `Origin`; it rotates refresh credentials. `POST /auth/logout` revokes the current session; `/auth/logout-all` revokes all sessions.

`GET /me`; `POST /users` (`name,email,password,role`); `PATCH /users/:id` (`active?,role?`). Admin accounts cannot be edited through the general staff endpoint. Admin bootstrap is local-only.

## Financial retry keys

Send `Idempotency-Key: <UUID>` for payment verification, dispatch, handover, refund completion, salary/advance payments, journal/reversal posting and supplier payments. Use the same key only when retrying the same action and same body. Successful results are retained for at least 24 hours until TTL cleanup. Different bodies with the same key return 409. Financial writes and replay records are committed atomically. Other transactional create/update POST commands also support optional retry keys; auth and document operations do not.

## Read listings

`GET /catalog` is public. Protected listings: `/orders`, `/inquiries`, `/records/{party,product,warehouse,batch,purchase,shipment,payment,return,journal,employee,audit}`. Role restrictions apply. They return `{items,nextCursor}`. Query: `limit=1..100` (default 25), `cursor=<last ID>`. No arbitrary filters/sorts or MongoDB query operators.

`GET /orders/:id` includes the order, shipments, payments and returns. `GET /orders/:id/proforma` returns invoice terms/customer/product snapshot. `GET /payment-methods` explicitly shows TT enabled and Visa disabled.

## Master data

| Method/path                    | Fields                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| POST `/records/party`          | name, type (`customer`/`supplier`), country?, email?, phone?, address? |
| POST `/records/product`        | name `{en,ps?,fa?}`, category?, grade?, origin?, packaging?, moq?      |
| POST `/records/warehouse`      | name, country?, address?                                               |
| POST `/records/employee`       | name, job?, salary (USD)                                               |
| PATCH `/records/product/:id`   | optional editable product fields, active?                              |
| PATCH `/records/warehouse/:id` | name?, country?, address?, active?                                     |
| PATCH `/records/employee/:id`  | name?, job?, salary?, active?                                          |

No destructive deletion of financial records. Sellers create customer parties; Procurement creates supplier parties; Admin/Manager can create both.

## Trading workflow

| POST path                 | Required/optional body fields                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/inquiries`              | product, quantity, customer? (staff only), destination?, source?                                                                                                    |
| `/inquiries/:id/proforma` | productTotal (USD), deliveryFees?, border, splitIncluded?                                                                                                           |
| `/orders/:id/revise`      | productTotal, deliveryFees?, border, splitIncluded?, reason                                                                                                         |
| `/orders/:id/accept`      | acceptanceEvidence? (required for staff recording customer's acceptance)                                                                                            |
| `/orders/:id/payments`    | amount (USD), method=`TT`, reference, receiptKey? (clean document ID)                                                                                               |
| `/payments/:id/verify`    | bankFundsConfirmed=`true`                                                                                                                                           |
| `/purchases`              | supplier, product, quantity, totalCost (USD)                                                                                                                        |
| `/purchases/:id/receive`  | warehouse, batchCode                                                                                                                                                |
| `/purchases/:id/pay`      | amount, reference                                                                                                                                                   |
| `/stock/transfer`         | batch, warehouse (destination), quantity                                                                                                                            |
| `/orders/:id/shipments`   | quantity, driver, vehicle, phone?, direct?, warehouse?; direct needs sourceBorder and directCost; added fee needs additionalFee, feeAccepted and acceptanceEvidence |
| `/shipments/:id/handover` | recipient, proof                                                                                                                                                    |
| `/orders/:id/returns`     | reason                                                                                                                                                              |
| `/returns/:id/complete`   | inspectionPassed, refundConfirmed, returnedQuantity, warehouse? (required after dispatch), note                                                                     |
| `/returns/:id/reject`     | reason                                                                                                                                                              |
| `/employees/:id/advance`  | amount                                                                                                                                                              |
| `/employees/:id/salary`   | month (`YYYY-MM`), deduction? (USD)                                                                                                                                 |

All quantities are tonnes, max three decimal places. All operational USD amounts are max two decimals. A splitIncluded flag is fixed by the proforma; it cannot be added to a shipment to bypass fees. Additional fee evidence is recorded on the shipment.

## Accounting

`GET /accounting/accounts` returns the chart of accounts. `POST /journals` accepts `memo` and `lines:[{account,debitCents,creditCents}]`; use the exact chart account names. Each line has one positive side, and totals must balance. `POST /journals/:id/reverse` reverses manual entries once. Operational entries are reversed through their original workflow.

Reports: `GET /reports/trial-balance`, `/income-statement`, `/balance-sheet`, `/cash-movements`. Financial statement date filters use `from=YYYY-MM-DD&to=YYYY-MM-DD`; balance sheet uses only `to`, preserving opening balances. The trial-balance endpoint is currently an all-time aggregate. `POST /accounting/periods/close` accepts `{month:'YYYY-MM'}` for a completed month; no historical journal posting API exists.

## Documents

`POST /orders/:id/documents`: raw file bytes, `Content-Type` PDF/PNG/JPEG, `X-Document-Name`, `X-Document-Kind` (`payment-receipt` or `trade-document`). Response `{id,status:'Quarantined'}`. Max 5 MiB. Customers can upload receipts only.

After actual scanning, Admin calls `POST /documents/:id/scan` with `{clean:true|false,scanner:'scanner identifier'}`. `GET /documents/:id` requires order ownership/authorized staff and Clean status; files download as attachments. Filesystem IDs are server-generated; filenames never become paths.

## Status codes

- 400 malformed JSON/query or missing retry key
- 401 missing/invalid/expired/revoked session
- 403 role or Origin denied
- 404 unknown endpoint or inaccessible customer record
- 409 duplicate financial reference, retry key mismatch or conflicting write
- 413 oversized payload
- 422 invalid fields or violated business rule
- 429 request/authentication limit
- 503 unavailable/busy service

Error responses contain `{error,requestId,details?}`; no database traces or secrets.

# v2 additions / changes

## Verification and recovery

- POST `/auth/verify-email`: `{token}`. Five-minute, hashed, one-use link token.
- POST `/auth/resend-verification`: `{email}`. Generic response, resend cooldown.
- POST `/auth/forgot-password`: `{email}`. Generic response, queues reset link.
- POST `/auth/reset-password`: `{token,password}`. Revokes sessions.
- POST `/auth/change-password`: `{oldPassword,newPassword,mfaCode?}`. Requires authentication; revokes sessions.
- POST `/auth/mfa/enroll`: `{password}`; returns secret/URI for authenticator enrollment only.
- POST `/auth/mfa/confirm`: `{code}`; activates MFA, returns recovery codes once and revokes sessions.
- POST `/auth/mfa/disable`: `{password,code}`; available to every role with password and valid MFA code.
- POST `/auth/login`: optional `mfaCode` (six-digit TOTP or 24-character recovery code).

Registration/staff creation now queue verification. Duplicate registration gets the same generic success response without overwriting an existing account. MFA is optional for every role. Staff user creation relies on unique email and does not store a replay fingerprint containing the initial password.

## Cards

- POST `/orders/:id/checkout`: `{amount}` plus Idempotency-Key. Uses optional approved USD adapter. Returns `{attempt,url}`; redirects never mark payment paid.
- POST `/webhooks/stripe`: raw signed Stripe event. Public only for signature verification; invalid signatures fail before state changes. Currency must be USD; amount and session must match a stored attempt.
- POST `/returns/:id/card-refunds`: `{payment,amount,inspectionPassed}` plus Idempotency-Key; Admin/Manager. Provider confirmation required. Pending refunds are retrieved on retry; explicitly failed/cancelled attempts release reservations. Financial return completion still records the final order-wide settlement and checks pending provider refunds.

The provider must have an eligible merchant account; adapter/contract tests are not real sandbox certification. No HesabPay USD conversion is invented.

## Accounting and reconciliation

- POST `/accounting/accounts`: `{code,name,type}`; adds an asset/liability/equity/income/expense account without replacing protected built-ins.
- POST `/accounting/expenses`: `{amount,category,memo,reference,order?}`.
- GET `/accounting/expenses`; GET `/reports/orders/:id/profit`.
- POST `/accounting/fiscal-close`: `{year}`; completed years only, all twelve months closed first. Profit transfers to retained earnings while income statements exclude closing entries.
- POST `/reconciliation/statements`: `{name,account,openingCents,closingCents,csv}`. Account Bank/Cash; CSV header `date,reference,amount`, signed USD amounts, dates `YYYY-MM-DD`.
- GET `/reconciliation/statements`; GET `/reconciliation/statements/:id` (paginated lines).
- POST `/reconciliation/lines/:id/match`: `{journal}`. Exact cash movement and unique match required.
- POST `/reconciliation/statements/:id/close`: `{}`. All lines matched and actual ledger closing balance equal to statement.

## Files, notifications, documents

- POST `/documents/:id/scan` now accepts `{}` only. It runs ClamAV; caller-supplied `clean/scanner` fields are rejected. A worker automatically processes quarantine and retries scanner outages.
- GET `/orders/:id/documents/proforma.pdf`, `/invoice.pdf`, `/packing-list.pdf`; authorized staff/customer ownership required. Generated PDFs are currently English.
- GET `/notifications`; POST `/notifications/:id/read` with `{}`. Customer-specific order events are private.

Precision, validation, role/ownership and business rules remain enforced by module Zod schemas and transactional services. The generated `openapi.json` describes JSON command bodies; this document supplies raw-file/webhook and GET contracts.

## v2.1 frontend read integration

- GET `/workspace/summary`: all-time permitted order totals, status counts, recent orders, 30-day UTC daily order values, new inquiries, and permitted inventory/payment indicators. Customer totals and recent orders are restricted to their party.
- GET `/users`: paginated safe account metadata for Admin/Manager. Managers see Seller/Procurement accounts. Password hashes, MFA secrets, recovery hashes and login internals are excluded.
- GET `/orders/:id/documents`: paginated metadata for authorized staff or the owning customer. File paths, scanner internals and digests are excluded. Existing scan/download restrictions remain.
- Listings return optional `_labels` containing names for referenced records. IDs remain unchanged.
- `/me` and login include email/MFA verification flags for account security screens.

No new write commands, dependency changes, data migration, or changes to existing financial business rules are introduced by v2.1.

## Uploaded-document availability

With `DOCUMENT_UPLOADS_ENABLED=false`, authenticated upload, scan and uploaded-file download requests return 503 with `Uploaded documents are disabled on this deployment`. Existing metadata and generated PDFs are unaffected. No document status is changed by this switch.

## Product image galleries

See PRODUCT_IMAGES_UPDATE.md for endpoints, image limits, permissions, storage and deployment steps. Product images use MongoDB-backed normalized raster assets independently of uploaded-document availability.

## Version 2.2 additions

MFA is optional for all roles. Enrolled MFA remains enforced at sign-in; disabling it requires the password and valid code.

- GET `/stock/summary`: staff only; product totals with per-warehouse quantities. Supports product, warehouse, search and cursor.
- POST `/orders/{id}/reserve`: allocate available stock for an accepted open order.
- POST `/orders/{id}/procurement-requests`: `{item?,note?}`; seller/admin/manager submits the computed shortage, not a caller-provided arbitrary quantity.
- GET `/procurement-requests`: staff list with status/search filters. Customers cannot access procurement.
- POST `/purchases`: optional `request` links demand; request product, order state and committed quantity are validated.
- POST `/purchases/{id}/receive`: accepts optional `location` and persists its received batch; linked demand is fulfilled and stock reserved where appropriate.
- Proforma issue/revise accepts optional `items:[{product,quantity,productTotal}]`. `productTotal` equals the sum of line totals. Without items, single-product behavior remains.
- POST `/orders/{id}/shipments`: optional `item`; required for multiple lines. Dispatch checks line quantities, order-wide verified deposit and protected reservations.
- GET `/orders/{id}`: adds items, invoices, approval/action history and role-filtered reservations, requests and purchases. Procurement receives no payment list; customers receive no internal procurement/reservations.
- POST `/orders/{id}/receipts`: raw JPEG/PNG/WebP <=3 MiB; private normalized image stored in MongoDB. Does not require filesystem uploads or ClamAV. Returns `{id,status}`.
- GET `/receipts/{id}`: authorized owner-order access only, normalized image download. A customer TT submission requires a valid receiptKey from its own order.
- POST `/products/{id}/video`: staff media managers; JSON `{size,mime}` with MP4/WebM and <=30 MiB. Returns upload ID and 1 MiB chunk size.
- POST `/products/{id}/video/{videoId}/chunks`: raw video chunk, Content-Type matches declared MIME; X-Video-Chunk integer ordinal starting at zero. Exact matching chunk retries are accepted.
- POST `/products/{id}/video/{videoId}/complete`: atomically publish the completed video and replace the old one.
- POST `/products/{id}/video/remove`: remove video and unfinished uploads for the product.
- GET `/catalog/{id}/video`: active-product public video; byte ranges bounded to 1 MiB per response. Video signature is validated, but no transcoding is provided.
- POST `/orders/{id}/invoices`: issue or reuse an immutable invoice snapshot for current commercial terms.
- GET `/invoices/{id}/pdf`: protected historical issued-invoice PDF. Existing generated PDFs remain available as current-state documents.
- GET `/notification-delivery`: manager/admin delivery-state list; encrypted mail payloads are excluded.
- POST `/notification-delivery/{id}/retry`: manager/admin retries an unexpired failed job. Expired account links must be resent through account recovery instead.
- POST `/jobs/notifications`: external scheduler, authenticated by NOTIFICATION_WORKER_KEY Bearer secret; processes bounded queued work without a user session.

List query additions: bounded `search`, `status`, `from`, `to`, and product/order/warehouse where the model supports them. Filters are combined with server-derived ownership and never replace it. Domain rules and role authorization remain authoritative. Product units: tonne, kg, piece, box, bag; SKU is unique when supplied.

## Profile and company settings (2.3)

`GET /api/settings/public` returns only public company content. `GET /api/settings/logo/:version` serves the public normalized logo.

All users can use `GET/PATCH /api/me/profile`, `POST /api/me/avatar`, `GET /api/me/avatar/:version`, `POST /api/me/avatar/remove`, `GET /api/auth/sessions`, and `POST /api/auth/sessions/:id/revoke`. Avatar reads always resolve to the authenticated user's own photo.

Only admins can use `GET/PATCH /api/admin/settings`, `POST /api/admin/settings/logo`, and `POST /api/admin/settings/logo/remove`. PATCH takes the complete company form plus numeric `revision`. Logo upload takes raw JPEG/PNG/WebP with `X-Settings-Revision`; removal takes `{revision}`. Stale revisions return 409.

Staff video preview: `GET /api/products/:id/video-info` and `GET /api/products/:id/video`, supporting byte ranges. Public active-product playback remains `GET /api/catalog/:id/video`.

## Storefront and HesabPay (2.4)

Public catalog: `GET /api/catalog` supports `search`, `category`, `origin`, `grade`, `limit`, and `cursor`. `GET /api/catalog/filters` lists active-product filter values; `GET /api/catalog/:id` returns one active product.

`POST /api/inquiries` accepts optional `items: [{product,quantity}]` and `preferredPayment: TT|VISA`. Header product/quantity must match the first item. The customer is derived from the authenticated account. A cart becomes one inquiry, and its quotation must price every requested product and quantity.

Company content: `POST /api/admin/settings/photos` accepts normalized raw image uploads with `X-Settings-Revision`. PATCH system settings updates photo ordering/removal and per-language content. `GET /api/settings/photos/:id` serves linked public company photos.

HesabPay configuration: admin-only `GET/PUT /api/admin/settings/hesabpay`. PUT accepts `revision`, `label`, `environment`, optional replacement `apiKey`, `afnPerUsd`, `enabled`, and `merchantApproved`. Read responses never contain API keys.

`POST /api/orders/:id/hesabpay-checkout` requires an idempotency key and `{amount,expectedAccount,expectedAfnMinor}`. `amount` is USD; the quoted AFN charge must match the server's merchant/rate snapshot. `GET /api/payment-methods` returns availability and non-secret conversion information.

The private URL `POST /api/webhooks/hesabpay/:account/:secret` verifies the provider signature and matches the private merchant reference, transaction ID, item and amount. Duplicate transaction callbacks cannot post twice. Account credentials and the exchange-rate snapshot remain linked to the original attempt. Follow `UPGRADE_2.4.md` before enabling production.

## Version 2.5 admin demonstration data

- `GET /api/admin/demo-data`: admin only; returns enabled/seeded state and prior account/count summary. No passwords are returned.
- `POST /api/admin/demo-data`: admin only, limited to five attempts per 15 minutes and disabled unless `DEMO_DATA_ENABLED=true`. Strict JSON body: `adminPassword`, `demoPassword` (12–128 characters), `confirmation: "ADD DEMO DATA"`. Reauthenticates the current administrator, then adds the one-time release-specific dataset transactionally. The existing admin account is retained. Existing demo-email/SKU collisions cause a conflict and rollback. Repeat calls return the original result. The audit stores counts, never passwords.
