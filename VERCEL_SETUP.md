# Vercel adapter update

The previous src/app.js exported only createApp(config), a factory used by src/server.js. Vercel auto-detected src/app.js but requires a default request handler. It now exports a lazy handler that uses the existing application factory, a cached startup promise and a bounded MongoDB connection pool. src/server.js remains the Render/local entrypoint. No app.listen or perpetual worker is started on the Vercel path.

## Copy these files into your existing Git repository

- src/app.js
- src/modules/platform/vercel-handler.js (new)
- src/modules/platform/vercel.runtime.js (new)
- src/modules/email/serverless-email.service.js (new)
- package.json
- package-lock.json
- tests/vercel.test.js and tests/vercel-runtime.test.js

Preserve your real .env, Render/Vercel secrets and existing database. Run npm ci locally to install the new pinned @vercel/functions dependency. Run npm run format:check, npm run check and npm test before pushing. No database reset is needed.

## Vercel project

Use the repository root containing package.json. Keep Express framework detection and its default build/output configuration. Use npm ci --omit=dev as the install command so the test-only MongoDB downloader is not installed. Do not use npm start as a Vercel build command. Vercel uses src/app.js; Dockerfile is for Render. Allow at least 120 seconds function duration for bounded email work (subject to plan limits).

Keep NODE_ENV=production, DOCUMENT_UPLOADS_ENABLED=false, TRUST_PROXY_HOPS=1 and the existing JWT_SECRET, DATA_ENCRYPTION_KEY, Atlas URI, exact HTTPS WEB_ORIGINS, FRONTEND_URL, confirmed return policy and Brevo SMTP settings. In this adapter upload/scan/file-download routes are unavailable; generated PDFs remain available. SMTP is used by the email tasks instead of a startup network check.

Ensure Atlas allows Vercel's outbound connection sources. Brevo's authorized-IP settings must also allow the Vercel connection source; the previously configured Render IP ranges do not identify Vercel. Never disable database TLS checks.

## Verify before switching the frontend

Deploy the new commit. GET https://trading-backend-pink.vercel.app/api/health/ready should return {"status":"ready"}. The root / has no homepage and can return Endpoint not found. Test catalog, login, verification/reset email delivery and MFA. Only then update Vercel frontend BACKEND_URL to https://trading-backend-pink.vercel.app and redeploy the frontend. NEXT_PUBLIC_API_URL stays /api.

## Email lifecycle and limits

Successful registration, resend-verification, forgot-password and staff-create requests register a waitUntil promise before response completion. After commit/response, a bounded task drains up to 10 outbox jobs and waits for short retry delays within a 75-second loop budget. Each SMTP attempt can add up to its transport timeout. Existing database leases coordinate concurrent tasks. This is request-triggered work, not an always-running worker or external durable scheduler. If the platform terminates a task or the budget is exhausted, pending jobs remain in MongoDB and can be retried by later email-producing requests; expired links cannot be delivered as valid links. Larger queues or reliable processing independent of traffic require a dedicated worker/scheduler. No perpetual timer is used on Vercel.

## Validation

70 existing and adapter tests passed, plus a real HTTP smoke test of the default handler using an isolated MongoDB replica set. Formatting/syntax checks passed. Real Vercel deployment, SMTP provider delivery and platform request lifecycle require live verification; local tests do not emulate Vercel's infrastructure.
