# Trading Company 2.3 — Profile, branding and product media

This package contains complete backend and frontend source based on the existing 2.2 upgrade. It has not been pushed to GitHub or deployed.

## Where to find the changes

- Every user: open **My profile & security** in the workspace, or click the profile avatar. Edit name, phone, country and address; upload, replace or remove a private photo; view active sessions and revoke another session. Existing change-password, optional MFA, recovery and sign-out controls remain available. Email and role are not editable through this page.
- Administrator: open **System settings**. Set company/system name, tagline, About title and content, contact email, phone, address, hours and HTTPS website. Upload, replace or remove the company logo. Other roles cannot access the settings endpoint or edit the content.
- Public website: **About** and **Contact** display the administrator's saved content. Shared branding appears in the site and workspace. Company name also brands newly queued account/business emails and generated commercial PDFs; existing issued records are not rewritten.
- Products: use **Manage images & video**, then choose the **Video** tab, or use **Upload / replace video**. Upload one MP4/WebM per product, up to 30 MiB. Images retain the existing multiple-image gallery. Staff can preview inactive products securely; customers see only public active-product media.

## Upload storage and protection

Profile photos and logos accept JPEG, PNG or WebP up to 3 MiB, validate and decode image bytes, strip metadata and store normalized WebP in MongoDB. Profile photos are private to their owner. Logos and active-product media are public. These image features work when general document uploads are disabled. Videos use the existing chunked MongoDB upload, one video per product; the transport validates size/container but does not transcode videos or replace antivirus scanning.

Settings use revision checks to reject stale saves. Profile/settings/media changes have audit records. All authorization is enforced in the backend.

## Apply the upgrade

1. Back up the database and keep your current deployment environment variables separately.
2. Copy the contents of `trading-backend` into your backend Git checkout, and `trading-frontend` into your frontend Git checkout. Preserve real `.env` / `.env.local` files. Never commit secrets.
3. In each project run `npm ci`. Backend checks: `npm run check`, `npm run format:check`, `npm test`. Frontend checks: `npm test`, `npm run test:ui`, `npm run test:integration`, `npm run build`.
4. Commit and push each project yourself. Deploy the backend first, then the frontend.
5. Keep backend `WEB_ORIGINS` and `FRONTEND_URL` on the same stable HTTPS frontend origin, without a trailing slash. Frontend `BACKEND_URL` is the HTTPS backend origin, without `/api`.
6. No new environment variables are required for 2.3. New collections and optional user fields are additive. For an older 2.1 database, follow `UPGRADE_2.2.md` migration instructions first. Do not run the empty-database demo seeder against your existing business database.
7. Sign in as admin, save company information/logo, then test the profile page and product Video tab. Check `/api/health/ready` after deployment.

Keep the existing security, return, payment and storage settings. Application settings do not expose deployment secrets, SMTP credentials, database credentials or allowed-origin configuration.

## Source baseline

Backend main: b7500007a29fc1b218d9245d5654e3684b9c5c79.
Frontend main: 63bcc47465aec0d95170ba473d8e031edec788f4.
