# Trading Company 2.4 — Public storefront, cart and HesabPay

This release contains the complete backend and frontend source. It has not been pushed to GitHub or deployed. Keep your current environment files and database encryption key.

## New public pages

- `/`: redesigned home page with bundled agricultural photography and a featured selection.
- `/products/`: product catalog with server-side search, category, origin and grade filters, plus pagination.
- `/product/?id=PRODUCT_ID`: separate product detail page with images, video, specifications and a quantity selector. The query ID makes the page compatible with both Vercel and static export hosting.
- `/cart/`: persistent cart containing up to 30 different products, individual quantities and a delivery destination.
- `/about/`, `/contact/`, `/terms/`, `/privacy/`, `/delivery/`: actual separate pages. The public navigation and footer link to these routes.

Pashto and Dari public copy, trade terminology and new settings labels have been reviewed. A bundled Noto Naskh Arabic font supports Pashto characters and right-to-left layouts without relying on the device's installed fonts. Dark/light modes and the existing color themes remain available.

## Customer flow

Browse → choose quantities → add one or multiple products → review cart and destination → sign in as customer → send one quotation request → sales prices every requested product → customer accepts quotation → pay by TT or enabled card checkout → follow procurement, dispatch and delivery in the existing order workspace.

The cart does not invent catalog prices or bypass accepted quotations. Stock is validated and allocated by the existing reservation/shortage procurement workflow when the quotation is accepted. Prices, fees, payment and return conditions remain attached to the order. Dispatch still requires the established 50% deposit rule. Existing cancellation and return rules are preserved.

A guest's cart survives sign-in. Product IDs and quantities are revalidated on the server. Inactive products, duplicate lines, invalid quantities and missing quotation lines are rejected. A cart request carries the preferred payment method; it does not charge the customer immediately.

## Administrator content settings

Open **System settings** in the workspace:

1. Edit the company name, tagline, English About content and contact information.
2. Open **Pashto and Dari page content** to edit each language's About and policy text.
3. Keep the starter photographs or upload your own JPEG, PNG or WebP images, up to 3 MiB each and four photos total. Uploaded photos are decoded, normalized and stored in MongoDB.
4. Change descriptions, reorder photos or remove unwanted photos, then **Save system settings**. The first photo also appears on the home page. To replace a photo when all four slots are occupied, remove it and save, then upload the replacement.
5. Terms, privacy and delivery pages have starter operational content. Enter your company-specific wording to override it; edit the corresponding translations for each language. An empty About introduction uses the starter text. Contact fields stay blank until the administrator supplies actual contact information.

Settings use revision checks to avoid overwriting another administrator's changes. General document uploads can remain disabled; company photos use normalized MongoDB image storage.

## Configure HesabPay and the receiving account

HesabPay uses a merchant account and API key. The receiving merchant is determined by the account owning that key. A receiving Visa card number is not a setting in this application. Check bank/wallet settlement details inside the HesabPay merchant portal.

1. Obtain an approved HesabPay merchant account and sandbox access. Ask HesabPay to enable international card payments for your merchant. Sandbox: https://developers-sandbox.hesab.com ; production: https://developers.hesab.com .
2. Generate a merchant API key in **Developer → API keys**. Use different keys for sandbox and production. Do not put the key in frontend environment variables or send it in chat.
3. Sign in to this system as administrator and open **System settings → HesabPay merchant account**.
4. Enter a descriptive merchant label, choose **Sandbox**, paste its API key, and set **AFN for 1 USD**. This is an administrator-maintained conversion rate, not an automatic exchange-rate feed.
5. Confirm merchant approval for the selected environment and enable checkout. Save the payment settings. API keys are encrypted with the existing `DATA_ENCRYPTION_KEY`, never returned to the browser and omitted from audit details.
6. Copy the returned webhook path. Prefix it with your backend's public HTTPS origin. Example structure: `https://YOUR-BACKEND/api/webhooks/hesabpay/ACCOUNT_ID/PRIVATE_TOKEN`. Register this full URL under **Developer → Webhooks** in HesabPay for successful and failed payments. Keep it private; it contains a callback credential.
7. Complete sandbox tests for success, decline, cancellation and repeated notifications. Confirm the correct merchant receives the payment. Payment redirects do not mark an order paid; the server verifies the provider notification and checks the reference and exact AFN amount first.
8. To go live, choose **Production**, supply that account's production key and confirm it is enabled for international cards. Register the newly generated production callback URL. Keep earlier account callbacks registered while their payments are pending.
9. Changing only the label, rate or enabled state preserves the callback URL. Changing credentials/environment creates an independent merchant configuration, so earlier payment callbacks can still be reconciled with their original account and exchange rate.

HesabPay prices are AFN. Orders and accounting remain in USD: the application stores the original AFN amount and conversion snapshot on each attempt/payment. The customer explicitly confirms the AFN charge before hosted checkout. The app never accepts or stores card numbers, expiry dates or security codes. Card payments below 40 AFN are blocked by this integration.

TT remains available alongside card payments. Existing Stripe support is retained as a fallback when configured. For HesabPay, leave `GATEWAY_PROVIDER=disabled` if you are not using Stripe; HesabPay is configured through the admin workspace, not that environment variable.

HesabPay refunds are performed in its merchant portal and then recorded with the existing return/refund confirmation and transfer reference. This release does not invent an undocumented automatic refund endpoint or send HesabPay transactions to Stripe.

If a checkout creation request times out after reaching the provider, reconcile that attempt before starting another payment. A duplicate in-progress attempt is blocked rather than risking an uncertain second charge.

Official integration references:
- https://docs.hesab.com/api-reference/authentication/
- https://docs.hesab.com/api-reference/create-payment-session/
- https://docs.hesab.com/payment-methods/international-cards/
- https://docs.hesab.com/webhooks/verify-signatures/
- https://docs.hesab.com/webhooks/event-payloads/

## Apply and deploy

1. Back up your database and preserve your deployment environment values, especially `DATA_ENCRYPTION_KEY`.
2. Copy `trading-backend` and `trading-frontend` into your existing Git checkouts, preserving real `.env` / `.env.local` files. Run `npm ci` in each folder.
3. Backend: `npm run check`, `npm run format:check`, `npm test`.
4. Frontend: `npm test`, `npm run test:ui`, `npm run test:integration`, `npm run test:dev`, `npm run build`.
5. Push and deploy the backend first, then the frontend. Backend `WEB_ORIGINS` and `FRONTEND_URL` should use your stable HTTPS frontend origin, without a trailing slash. Frontend `BACKEND_URL` is the backend HTTPS origin, without `/api`.
6. Version 2.4 adds optional fields and collections. No destructive migration or reseeding is required when upgrading from 2.3. If upgrading from 2.1, apply the documented 2.2 migration first.
7. Review content, upload real company/product photos, configure HesabPay in sandbox and run a full customer checkout before enabling live payments.

No real merchant credentials or production payment were used during development verification. Local payment integration tests use a controlled HesabPay API stub; they verify application behavior, not your merchant activation or live settlement.
