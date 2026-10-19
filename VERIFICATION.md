# Verification report — 2026-10-14

The test log is retained in TEST_RESULTS.txt. This release passed unit, adapter, MongoDB integration, concurrency and seeded HTTP process system tests. Line/branch/function coverage is measured for src/**/*.js, excluding test files. Passing tests are not a proof of perfect security or exhaustive behavior.

The system test seeds a disposable replica set twice (idempotence), starts src/server.js in a child Node process, logs in role accounts, accepts a proforma, verifies TT deposits, dispatches, collects the balance, confirms border handover, returns goods, processes a refund, and checks inventory and the balanced ledger.

Adapter tests inspect TLS options, cryptographic signatures, USD request bodies, replay keys and streaming ClamAV frames. SMTP/Stripe adapters use test doubles for network calls; no external merchant charge/refund or real SMTP delivery was attempted. ClamAV protocol tests use a local protocol fixture, not a production daemon with virus definitions.

The benchmark is a local 10,000-product read smoke test; it does not measure production capacity or failover. Audit results describe known dependency advisories only. The Dockerfile and CI workflow are supplied but a Docker image/build or remote GitHub CI run was not executed here.

Company-specific return disputes/partial returns/inspection samples and live provider/account suitability remain explicit in REQUIREMENTS.md. Activate live service configurations and run staging acceptance, restore checks and independent security review before launch.

The v2.1 run passed **57 tests**, with **94.81% source line coverage**. Four new seeded integration tests cover safe staff projection, role restrictions, customer dashboard isolation across more than one page, private document metadata and display labels. Existing 53 tests continue to pass.
