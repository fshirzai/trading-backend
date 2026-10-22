# Trading Company 2.2 - review and upload guide

Prepared 23 October 2026. Both source folders are included. GitHub was read to establish the baseline; no repository branch, deployment or production database was changed.

## What changed

- Optional MFA for every role. Enrolled users still need valid MFA/recovery codes; email verification remains required.
- Backend image support reconciled with the existing frontend image manager. Up to eight images, cover ordering, replacement and deletion.
- One video per product, MP4/WebM, up to 30 MiB, uploaded in bounded 1 MiB chunks with resumable chunk retries and byte-range playback. Video files are signature checked; they are not transcoded or certified for every browser codec.
- SKU and product units; one master product across all warehouses. Warehouse summary, per-product stock locations, on-hand/reserved/available quantities and batch storage location.
- Order product lines, preserved accepted line snapshots, line-specific dispatch and settlement. Legacy single-product orders remain readable.
- Stock reservation at acceptance; another order cannot dispatch or transfer reserved stock. Seller can request procurement for a shortage. Purchase and receipt link back to the request/order, and received stock can be allocated to it.
- Order workspace shows items, payments, shipments, returns, reservations, procurement and approval/action history. Customer responses omit internal procurement and reservation records. Procurement has a work-focused dashboard.
- TT receipt image uploads work without filesystem storage or ClamAV. JPEG/PNG/WebP input, max 3 MiB, decoded/re-encoded to WebP and stored privately in MongoDB. Customers must select a receipt when submitting TT; staff still verify actual funds. PDF receipts remain on the existing scanned-document path and require that feature to be configured.
- Issued invoices persist an immutable numbered snapshot. Reissuing unchanged terms returns the same invoice; changed commercial terms create a new record. Historical issued PDFs remain available.
- Returns preserve receiving warehouse, created stock batches, refund reference and approving actor. Returned stock movements now explicitly reference their batches. Completion releases remaining reservations.
- Dashboard notifications and encrypted email outbox jobs are written in the same transaction as business events. Inquiry/quotation emails contain summaries and sign-in links. A scheduler endpoint drains the queue independently of website activity; managers can inspect failures and retry unexpired failed jobs. SMTP delivery is at-least-once: an uncertain SMTP acknowledgement can still cause a duplicate email.
- Bounded server-side search, status/date/reference filters on applicable lists; frontend search reaches the server rather than only filtering the displayed page. Warehouse summary has its warehouse selector.
- Snapshot backup and isolated restore verification commands include Mongo-stored images, video chunks and receipt data. Migration defaults to dry run.
- Frontend Next.js updated from 16.4.0 to 16.4.2 after dependency audit findings.

## Agreed policy retained

Before dispatch: refund all verified money paid. After dispatch: retain 25% of total order value, refund paid funds minus retention. Verified deposit before dispatch: 50% of product value. Return period: configured, initially 24 hours, starting with the first handover for a split order. Partial returns are not supported: all dispatched goods must be returned and pass inspection.

## 1. Test locally against a separate database

Extract this archive. Each folder is the root of its corresponding GitHub repository. Do not replace your real secret files with examples.

Backend PowerShell:

```powershell
cd "YOUR_PATH\trading-backend"
npm ci
npm run check
npm run format:check
npm test
```

Frontend PowerShell (second terminal):

```powershell
cd "YOUR_PATH\trading-frontend"
npm ci
npm test
npm run test:ui
npm run test:integration
npm run build
```

The integration test expects the sibling folder `../trading-backend`; set BACKEND_DIR if your layout differs. Test suites use disposable replica-set databases and do not seed production. The first run can download MongoDB test binaries. A MongoDB replica set remains required for real transactions.

## 2. Backend environment

Keep the existing MONGODB_URI, JWT_SECRET, DATA_ENCRYPTION_KEY and working SMTP credentials. Do not rotate the encryption key casually: existing encrypted MFA secrets and queued messages depend on it.

```dotenv
NODE_ENV=production
WEB_ORIGINS=https://trading-frontend-navy.vercel.app
FRONTEND_URL=https://trading-frontend-navy.vercel.app
RETURN_HOURS=24
RETURN_POLICY_CONFIRMED=true
DOCUMENT_UPLOADS_ENABLED=false
TRUST_PROXY_HOPS=1
NOTIFICATION_WORKER_KEY=GENERATE_A_NEW_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
```

Use the actual stable frontend domain if it has changed. Exact HTTPS origin, no trailing slash. Trust-proxy hops must match your actual hosting path. Let the host supply PORT when it does so. There is no new mandatory MFA environment flag. SMTP keys and database credentials must stay outside GitHub.

Images, video and normalized receipt images are Mongo-backed and work with DOCUMENT_UPLOADS_ENABLED=false. Arbitrary PDF/trade-document uploads still require the existing durable file storage/scanner setup; this update does not provision those services.

## 3. Back up and check the migration

Use a local terminal with your backend's real environment only when intentionally backing up that database. Store backups outside GitHub and outside the public upload folder.

```powershell
npm run backup -- "E:\secure-backups\trading-before-2.2.jsonl.gz"
$env:RESTORE_DATABASE="trading_restore_review_20261023"
npm run restore:check -- "E:\secure-backups\trading-before-2.2.jsonl.gz"
npm run migrate:check
```

The backup writes a SHA-256 sidecar; keep both files together. The restore command refuses existing nonempty target databases and only accepts a `trading_restore_...` name. It verifies checksum, document counts and inventory invariants. It intentionally omits TTL indexes in the temporary verification database; this is not an automatic production restore. Inspect the restored data, then remove the verification database deliberately when finished. Back up encryption keys separately and securely.

The snapshot script covers MongoDB. It refuses a setup with filesystem document uploads enabled so you cannot accidentally assume those external files were backed up. Production restore/failover, backup retention and offsite scheduling must be configured operationally; scripts alone do not schedule backups. Large databases should use a managed backup mechanism rather than a long-running application transaction.

When the dry run and test restore are satisfactory, pause old backend writes, take a final backup, then run:

```powershell
npm run migrate:apply
```

Run this once from a trusted terminal, not on every serverless request. It is repeatable and preserves existing amounts, payment records, accepted snapshots and journals. It adds line structure to legacy orders, links old shipments and allocates available stock for eligible open orders. Review allocation fairness before resuming work. Do not run the old backend alongside the new one after reservations are enabled: old code does not honor reservations. A rollback needs a coordinated database/application plan rather than simply redeploying old code.

## 4. Notification processing

Render's long-running worker still runs while the service is awake. Vercel also runs bounded background draining after successful write requests. To process mail reliably without visits, configure an external scheduler to POST this endpoint at a suitable interval (for example once per minute):

```text
https://YOUR_BACKEND_HOST/api/jobs/notifications
Authorization: Bearer YOUR_NOTIFICATION_WORKER_KEY
```

Use a real generated secret; do not use the literal placeholder. The endpoint is not a public unauthenticated email sender. A host that sleeps can still delay scheduler requests. Monitor failed jobs in the Email delivery workspace and verify a real inbox end to end.

## 5. Upload and deploy

Review each folder, then copy its contents into the matching repository checkout. Preserve existing .env files locally. From each repository:

```powershell
git status
git add -A
# Inspect the staged filenames below; remove any unexpected private files.
git diff --cached --stat
git commit -m "Upgrade trading workflows to 2.2"
git push origin main
```

The exact staging list differs between repositories; inspect `git status` and stage the actual source/config/documentation changes. Never stage .env, backups, node_modules or build output. Frontend BACKEND_URL remains the backend base origin without /api. Deploy the backend first and then the frontend. This archive does not publish or deploy on your behalf.

## 6. Smoke test after deployment

1. Register/verify a customer and confirm optional MFA works for both customer and admin.
2. Upload several product images and one video; test playback on the intended phone/browser.
3. Receive the same product into two warehouses and verify totals and locations.
4. Submit an inquiry and issue/revise/accept a quotation; check email and in-app notices.
5. Confirm reservations, shortage request, linked purchase/receipt and allocation.
6. Upload a TT receipt, submit payment and verify bank funds; inspect the order history.
7. Dispatch product lines, record handover and issue/download a stored invoice.
8. Return eligible goods, select receiving warehouse and record refund evidence. Verify stock and ledger.
9. Use a second customer to confirm order, invoice, receipt and notification isolation.
10. Confirm health readiness, notification scheduler and scheduled backup/restore monitoring.

## Boundaries for this release

Reservation expiry, quotation validity periods and an exact included-shipment count have not been invented: current accepted terms and the existing split-inclusion boolean remain. Procurement receives a purchase in one operation; partial purchase receipts and partial customer returns are not added. There is no configurable permission builder or new finance role. This release has automated regression coverage but has not been load-tested or browser-tested against your production accounts or live SMTP account.
