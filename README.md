# Trading Company Backend — v2

Standalone modular Node.js/Express/MongoDB backend. No frontend or browser sample-data runtime is included.

## Local setup (Windows / VS Code)

Use Node.js 24 (22+ supported), npm and MongoDB Atlas or another replica set. A standalone MongoDB server cannot provide the multi-record transaction guarantees used here.

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Set `.env`: `MONGODB_URI`, the first generated value as `JWT_SECRET`, the second as `DATA_ENCRYPTION_KEY`, your frontend origin, SMTP credentials/from address, ClamAV host/port and administrator bootstrap credentials. Never commit `.env` or send secrets in a chat. Keep the encryption key backed up securely: changing it without migrating stored ciphertext makes MFA secrets and queued mail unreadable.

For an empty real database:

```powershell
npm run bootstrap
npm run dev
```

Bootstrap creates one administrator with your supplied password and trusted bootstrap email. Remove `ADMIN_PASSWORD` afterwards. New customer and staff accounts must verify email. In production Admin/Manager can sign in but cannot use privileged work until enrolling in MFA.

For a separate empty development/demo database, set `SEED_PASSWORD` and run **instead of bootstrap**:

```powershell
npm run seed:demo
npm run dev
```

The seeder is repeat-safe, refuses production and refuses to add a demo administrator to an existing database. It creates five role accounts (`admin`, `manager`, `seller`, `procurement`, `customer` at `demo.test`), three warehouses, products, parties, stock, a purchase, balanced opening journals, an inquiry and an employee. Its password is the value you set; it is never printed. Demo accounts are preverified solely for testing. Keep them away from production.

API base: `http://localhost:4000/api`. Liveness/readiness: `/health/live` and `/health/ready`. See `API.md` and `openapi.json` for contracts.

## Run without ClamAV (uploaded documents disabled)

Set `DOCUMENT_UPLOADS_ENABLED=false` in Render. Keep `NODE_ENV=production`. With this explicit setting, startup still verifies SMTP but skips ClamAV verification and starts no scanner timer. POST `/api/orders/:id/documents`, POST `/api/documents/:id/scan` and GET `/api/documents/:id` return HTTP 503 after authentication/role checks, before file access. Existing documents keep their original statuses; nothing is automatically cleared or deleted. Metadata lists and server-generated proforma/invoice/packing-list PDFs remain available. The current TT API permits recording a transfer reference without a receipt; this setting does not change payment verification or accounting rules. The frontend document controls are unchanged and will display the API error if used while disabled.

Remove CLAMAV_HOST/CLAMAV_PORT if unused. Default is enabled: only the exact value `false` disables uploads. To restore uploads, provision persistent storage and a reachable scanner, then set `DOCUMENT_UPLOADS_ENABLED=true`, CLAMAV_HOST and CLAMAV_PORT=3310, and redeploy. No production test has established capacity on 512 MB RAM; watch memory, particularly during concurrent login/password hashing. Render's ephemeral filesystem is not durable document storage.

## Account email appearance

Verification and password-reset mail include a responsive navy/emerald HTML layout, a personalized greeting, action button, copyable fallback link, five-minute expiry and security note, with a plain-text alternative. Set optional `EMAIL_BRAND_NAME` (default `Trading Company`) in Render to change the header, subject and footer. The sender remains your verified `MAIL_FROM`. The templates use inline styles and presentation tables, with no remote images, fonts, scripts or tracking pixels. Names, branding and URLs are HTML-escaped. Token generation, hashing, encrypted outbox, expiry and one-use handling are unchanged. Existing queued jobs retain their original email body; new requests use the new template.

Nonfunctional previews are in `docs/email-previews/verify.html` and `reset.html`. These use a dummy URL and never contain a real token. Actual Gmail/Outlook rendering and delivery must be checked after deployment.

## Module layout

Each business module keeps its models, route/controllers, services and validation contracts in `src/modules/<module>/`. Small root registries connect the modules; `src/shared/` holds transaction, HTTP, validation, encryption and generic CRUD mechanics. Generic CRUD declarations are inside their owning module, not a central business-controller file.

| Module                  | Responsibility                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- |
| auth                    | Accounts, verification, recovery, password changes, sessions, MFA, staff lifecycle    |
| email                   | Encrypted transactional outbox, SMTP/TLS adapter, delivery retry worker               |
| contacts / catalog      | Customers, suppliers, translated products/specifications/MOQ                          |
| sales                   | Inquiries, proforma versions, acceptance and immutable commercial snapshots           |
| procurement / inventory | Purchases, warehouse receipts, FIFO batches, transfers, stock/value integrity         |
| logistics               | Split dispatch, direct border trades, delivery fees, border handover proof            |
| payments                | TT verification, optional USD hosted checkout, signed webhooks, card refund tracking  |
| returns                 | Timed requests, inspections, rejection, refund and inventory/ledger reversals         |
| accounting              | Chart of accounts, entries/reversals, expenses, statements, month/fiscal-year closing |
| reconciliation          | CSV bank statements, matching and closing against actual ledger balances              |
| payroll                 | Employees, salaries, advances and deductions; no attendance                           |
| documents               | Protected upload/download, quarantine, ClamAV adapter/worker, commercial PDFs         |
| notifications / audit   | Private customer events and append-only audit history                                 |
| platform                | Shared rate limiting and transactional request replay protection                      |
| database                | Development/demo data seeding                                                         |

## Security and integrity

- Asynchronous scrypt passwords, random salts, constant-time comparison and bounded hashing concurrency. Production N=131072/r=8/p=1; tests use a smaller cost except the production-password test. Allow at least 1 GiB RAM for comfortable headroom.
- Five-minute verification/reset links; only token hashes are stored. Reset/change revokes sessions. Resend cooldown: 1 minute, 5 minutes, then 1 hour. Forgot-password responses do not disclose account existence.
- 15-minute access tokens and rotating HttpOnly/SameSite=Strict refresh cookies. Refresh replay revokes the session. Deactivation/role change invalidates sessions.
- TOTP MFA secrets encrypted with AES-256-GCM; enrollment requires the password, expires after five minutes, revokes old sessions and returns ten hashed, one-use recovery codes. OTP counters prevent code replay. Privileged MFA is enforced in production.
- Exact CORS origins, strict schemas, capped bodies/queries, generated request IDs, shared MongoDB rate limits and account lockouts. Production rejects HTTP for business routes; fixed trusted proxy hops and HTTPS termination must be configured. Liveness/readiness may be checked over the private HTTP port.
- Integer cents, normalized tonne quantities, indexed cursor pagination, bounded pools/query timeouts, and MongoDB transactions for stock, money, journal, audit and replay records. Posted ledger/audit/stock movements cannot be edited through application models.
- Files never use supplied names as filesystem paths. PDF/PNG/JPEG only, matching signature, 5 MiB maximum, protected attachment downloads, integrity hash and actual ClamAV result. Quarantine remains closed when scanning fails. An automatic worker retries scans; an Admin can trigger another real scan, not assert that a file is clean.
- SMTP requires certificate-verified TLS; URL/file attachment access is disabled. Mail payloads are encrypted, with retry/expiration handling. Workers are at-least-once delivery: a crash after SMTP acknowledgement can send an email twice; links remain one-use. Financial commands use their separate replay controls.

## Business rules

USD only. Quantities are tonnes with at most three decimals. Operational USD inputs have at most two decimals; stored journal amounts are integer cents.

Inquiry → versioned proforma → acceptance → verified payment → shipment → border handover. Staff record website, WhatsApp, phone and office inquiries. Product descriptions and original accepted terms remain preserved after catalog edits or later accepted delivery charges.

At least 50% of product value before dispatch. Remaining product value is collected proportionally at each split delivery; delivery fees are due by handover. Original split inclusion is fixed by the proforma. Later extra delivery fees require recorded customer acceptance evidence.

Warehouse dispatch is FIFO without negative stock and preserves exact remaining stock value. Direct border-to-border shipments do not invent a warehouse receipt. The direct-trade cost posts to payables/COGS; detailed direct-trade supplier-bill linkage remains an extension, not a warehouse operation.

Before shipping, refund verified paid funds. After shipping/handover, retain 25% of the current agreed order total and refund paid funds minus that charge. Retained funds cover return transport/staff costs. Inspect goods and verify actual returned quantity/refund before completing; card refund commands additionally verify provider confirmation and track pending/failed/succeeded outcomes.

The return window is provisionally 24 hours and stored on each order. For full-order returns covering multiple handovers, every handed-over shipment must still be within its window. Request timeliness preserves eligibility while transport occurs later. Partial-item returns, damaged-on-arrival compensation and inspection sample allowances require exact company rules and are not silently guessed. Version 1 is online only; attendance/offline synchronization remain excluded as requested.

## Payment provider boundary

TT is functional with manual bank-fund verification. A Stripe USD adapter includes hosted checkout, raw-body signed webhooks, currency/amount/session checks, duplicate-event protection and idempotent refunds. It stays disabled by default. Enabling requires an eligible merchant account, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GATEWAY_PROVIDER=stripe`, merchant approval and real sandbox validation. Adapter tests use fixtures; no live card charges were made.

HesabPay's current documentation treats checkout prices as AFN. It is therefore **not** wired as a USD gateway. This company must confirm a merchant-supported USD solution or explicitly approve a currency conversion policy before using HesabPay. Do not mislabel AFN amounts as USD. Stripe merchant eligibility must also be confirmed; this adapter does not make an unsupported business eligible.

References: [HesabPay currencies](https://docs.hesab.com/payment-methods/international-cards/), [Stripe availability](https://stripe.com/global), [Stripe raw webhook verification](https://github.com/stripe/stripe-node), [SMTP TLS](https://nodemailer.com/smtp), [ClamAV protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).

## Tests and checks

```powershell
npm test
npm run test:unit
npm run test:integration
npm run test:system
npm run test:coverage
npm run check
npm run format:check
npm run benchmark
npm audit
```

Tests use ephemeral MongoDB replica sets, never `.env`'s company database. A first run can download MongoDB. Unit/adapter tests cover crypto, currency, CSV, TLS options, raw signatures and ClamAV streaming. Integration tests cover access/roles, recovery/MFA, stock/payment concurrency, replay, payroll, returns, reconciliation, closing and protected documents. System tests spawn the actual Node HTTP process against a repeated-seed fixture and run inquiry through paid delivery and return. `TEST_RESULTS.txt` records results and source coverage; uncovered branches remain visible. Passing tests are not proof that every possible failure or attack is covered.

`BENCHMARK.json` records a local smoke benchmark with 10,000 products, 100 authenticated reads, concurrency five and index work. It is not production capacity certification. `.github/workflows/backend.yml` runs checks in CI.

## Deployment

Use `npm ci --omit=dev`, production secrets/configuration and `npm start`, or the non-root Dockerfile. Set exact HTTPS `WEB_ORIGINS`/`FRONTEND_URL`, a separate encryption key, `RETURN_POLICY_CONFIRMED=true`, SMTP/TLS, ClamAV and durable private uploads. Production startup checks MongoDB replica-set capability, SMTP and scanner connectivity. Workers need a long-running Node host, not a request-only static hosting runtime.

Serve frontend and API under the same site (custom subdomains or a Next.js API proxy) for SameSite=Strict refresh cookies. Restrict direct access to the Node port when trusting proxy headers. Use least-privilege authenticated/TLS MongoDB access, managed backups and tested restore, monitoring, secret rotation with ciphertext migration, scanner-signature updates, staging acceptance and an independent security review. These are deployment operations; source tests cannot verify a service/account that has not been configured.

This release implements the named features in `REQUIREMENTS.md`. It does not claim to contain every imaginable trading-company feature or an audited statutory accounting system. Company-specific return disputes, direct supplier subledgers and external service validation are listed explicitly rather than hidden behind a “complete” label.

## Multiple product images

See PRODUCT_IMAGES_UPDATE.md. Products support eight persistent MongoDB-backed images, optimized thumbnails, galleries and staff management without enabling document uploads.
