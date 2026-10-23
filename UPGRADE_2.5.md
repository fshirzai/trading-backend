# Trading Company 2.5 — Languages and admin demo data

This package contains the full updated backend and frontend source. It has not been pushed or deployed. Existing environment values and DATA_ENCRYPTION_KEY must be preserved. Upgrade 2.4 features, including cart and HesabPay, are retained.

## What changed

The home headline is now **Agricultural products for your business.**

- Pashto: **ستاسو د سوداګرۍ لپاره کرنیز محصولات.**
- Dari: **محصولات زراعتی برای تجارت شما.**

Public shopping and quotation wording, dashboard terminology, company introduction defaults and demo setup labels have been revised. Previous scattered UI translation tables now resolve through one central dictionary. Existing company text that an administrator has saved is retained; edit it in System settings to change its wording. The exact old default tagline is presented with the new default wording.

## How many dashboards?

There are **five roles**, using one shared dashboard system. There are three overview experiences: company overview (admin/manager/seller), procurement overview, and the customer's own orders. Menus and server access depend on role; five completely separate dashboard applications are not being maintained.

| Role | Dashboard and workspace |
| --- | --- |
| admin | Company overview and all administrative modules; System settings and demo-data controls |
| manager | Company overview and permitted operational/financial/staff modules |
| seller | Sales overview, inquiries, orders and permitted sales operations |
| procurement | Shortages, purchases awaiting receipt, products, stock and warehouses |
| customer | Only the customer's own inquiries, orders, payments and returns; profile/security |

## Add sample data from the administrator screen

1. Deploy both projects. No database reset or reseeding is required for the upgrade itself.
2. Temporarily set **DEMO_DATA_ENABLED=true** in the backend's deployment environment and redeploy it. This feature defaults to disabled, including in development.
3. Sign in using your **existing administrator** account.
4. Open **System settings → Demo data** near the bottom of the settings page.
5. Enter your current administrator password and choose a demo password of at least 12 characters. Keep the demo password yourself; the application hashes it and never returns it.
6. Type **ADD DEMO DATA** exactly and select **Create demo data**.
7. The resulting account list shows these accounts:

| Role | Login |
| --- | --- |
| admin | Your existing administrator email and unchanged password |
| manager | manager.v25@demo.test |
| seller | seller.v25@demo.test |
| procurement | procurement.v25@demo.test |
| customer | customer.v25@demo.test |

The four new accounts use the demo password you entered. Their email verification is pre-completed because `.test` accounts cannot receive real verification mail. MFA stays optional. There is only one administrator in this system; the seed does not create a second administrator or change your account.

8. Set **DEMO_DATA_ENABLED=false** again and redeploy the backend. The records and demo logins remain available; the seed endpoint is disabled. When testing ends, deactivate the demo staff/customer accounts through the normal account-management process appropriate to their role.
9. Refresh Products, Inquiries, Inventory and Warehouses to see the added data. Demo inquiries appear under the demo customer's account. Orders start after a sales user issues a quotation and the customer accepts it; fake paid orders or card payments are not inserted.

### Sample dataset

- 3 products: red kidney beans, chickpeas and red lentils, each with English/Pashto/Dari names and a matching bundled photograph.
- 2 warehouses: DEMO Kabul and DEMO Ghazni.
- Each product has 10 tonnes in Kabul and 20 in Ghazni, totalling 30 tonnes as **one product**, with two stock batches.
- 6 received purchases and stock movements, a supplier, a customer party, 3 pending quotation requests and a balanced inventory/payables journal.
- Sample records are identified by DEMO names or DEMO25 SKUs. Illustrative stock origin, quality and prices are demo fixtures, not claims about actual company inventory. Photos are illustrative, CC0-licensed product images.

**Sample stock and accounting entries affect real inventory totals and reports.** Use a demonstration database when you need to keep business reports free of test transactions. The feature adds to an existing database; it does not delete records or overwrite existing users, products or warehouse quantities. Running it again returns the original result without creating duplicates. Conflicting demo emails or SKUs reject the seed transaction instead of overwriting records. Errors roll back the database writes.

Do not delete warehouses/products that later participate in trading transactions. This release intentionally has no blind 'clear all demo data' button.

## Where the three languages are stored

| Content | Authoritative location | How to change it |
| --- | --- | --- |
| Interface translations: navigation, buttons, statuses, public starter wording | `trading-frontend/src/shared/locales/messages.json` | Edit the values inside `en`, `ps`, `fa`; preserve keys; rebuild and redeploy frontend |
| Product names | MongoDB `products`: `name.en`, `name.ps`, `name.fa` | Edit the product's three name fields in the product form |
| Company name/contact/logo and About/policy content | MongoDB `systemsettings`, document `_id: company` | Administrator → System settings; English fields plus Pashto and Dari page-content section |
| Uploaded product image bytes | MongoDB `productimages`; product `images` stores linked metadata | Product image manager |
| Starter company defaults before admin edits | Backend `src/modules/settings/settings.model.js` and frontend `src/modules/settings/BrandingProvider.jsx` | These are fallback defaults; use System settings for a running company's content |

### Edit the central dictionary

Open `src/shared/locales/messages.json` in the frontend. A translation has the same English identifier in all three objects:

```json
{
  "en": {"Agricultural products for your business.": "Agricultural products for your business."},
  "ps": {"Agricultural products for your business.": "ستاسو د سوداګرۍ لپاره کرنیز محصولات."},
  "fa": {"Agricultural products for your business.": "محصولات زراعتی برای تجارت شما."}
}
```

Edit the **right-hand value**, not the identifier. `fa` is the existing Dari language code in this application. Save as UTF-8. Do not add comments or trailing commas to JSON. The old `translations.js` and `store-translations.js` files are compatibility imports only; they contain no independent translation text. There is no automatic translation service and no translation of user-entered text.

## Deployment and checks

- Preserve `.env` files and the existing database encryption key. No new dependencies are required.
- Backend: `npm ci`, `npm run check`, `npm run format:check`, `npm test`.
- Frontend: `npm ci`, `npm test`, `npm run test:ui`, `npm run test:integration`, `npm run test:dev`, `npm run build`.
- Deploy backend first, then frontend. Use your existing stable frontend/backend URLs.
- Company/product photos are bundled in the backend `src` tree and copied by its existing Dockerfile. The seed reads local assets; it does not fetch remote images during a request.
- Existing HesabPay merchant setup remains unchanged; consult UPGRADE_2.4.md for sandbox activation and callback setup.
