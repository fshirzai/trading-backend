# Requirements coverage and boundaries

The verified scope is the user's confirmed trading-company requirements and the named backend deployment gaps. “All real-system features” has no finite definition; the table makes implemented scope and unresolved decisions inspectable.

| Requirement | Backend behavior | Verification |
| --- | --- | --- |
| Node.js + MongoDB | Standalone API, replica-set startup check, transactional models | Integration + separately spawned server |
| Admin/Manager/Seller/Procurement/Customer | Role checks, customer isolation, staff lifecycle, production privileged MFA | Authorization/security tests |
| English/Pashto/Dari | Product translation fields; API frontend-neutral; generated PDFs English | Seed/data checks; frontend remains future work |
| Light/dark design | Frontend responsibility | Excluded from backend release |
| Inquiry/proforma/acceptance | Sources, versions, snapshot, revision limits/reacceptance | Integration/system |
| 50% before dispatch, balance at border | Verified payments only; proportional split balances | Unit/integration/system; proportional policy provisional |
| TT | Receipt quarantine/scan, manual bank verification, duplicate/overpayment controls | Concurrency/integration |
| Visa/online payment | Optional USD adapter, signed webhooks, safe redirects, refund tracking | Unit/contract/integration; real merchant sandbox pending |
| Multiple warehouses | Receipts, FIFO, transfers, quantities/cost conservation | Rollback/concurrency/fractional-value tests |
| Border-to-border direct trades | No fictitious warehouse movement; cost/payable posting | Integration; detailed direct supplier-bill linkage not provided |
| Multiple deliveries | Quantity cap; original split agreement; accepted later fees | Integration |
| Border delivery | Recipient/proof and balance check | System/integration |
| Returns before shipping | Full verified-paid refund | Integration |
| After shipping/handover | 25% order-total charge, paid funds minus charge, inspect/restock/reverse | Integration/system |
| Return time/condition | Configured window, requests before expiry, quantity/condition confirmation | Boundary/integration; exact window/sample/dispute rules need company approval |
| Transport costs covered by retained 25% | No extra return transport charge | Refund tests |
| USD full accounting | Double entries, chart/expenses, deposits/AR/AP, statements, supplier settlement, months/year close | Balance/reconciliation/fiscal tests; not statutory audit certification |
| Salaries/advances, no attendance | Employee records, advance deductions, unique salary/month | Integration |
| Email verification/forgot/reset/change | Expiring hashed links, SMTP outbox/retries, revocation | Unit/adapter/integration; actual SMTP account verification at deployment |
| MFA | Encrypted TOTP, replay prevention, recovery codes, privileged policy | Integration/security |
| Private documents + scanning | Safe types/path limits, integrity, ClamAV worker and access checks | Adapter/integration; live ClamAV required |
| Commercial documents | Protected proforma/invoice/packing-list PDF | PDF response/ownership tests |
| Notifications/audit | Private order events, append-only audit/movements/journals | Integration |
| Seeded unit/integration/system tests | Repeat-safe demo seeder, disposable DB, spawned process | Automated test suite |
| Performance | Indexes/cursors/pool/timeouts; measured local read benchmark | BENCHMARK.json; deployment load testing pending |
| Deployment operations | Non-root image, CI, startup checks, graceful shutdown | Syntax/format/system tests; real hosting/backups/restore remain operational |
| Offline | Not included in v1, as requested | Explicit exclusion |

Unresolved business details are not silently invented: partial-item returns, quality-claim compensation, allowed inspection samples and physical-return deadlines. Those require concrete rules before code can truthfully implement them. The checkout provider must match USD and merchant eligibility; current HesabPay AFN behavior is incompatible without an explicitly approved conversion policy.
