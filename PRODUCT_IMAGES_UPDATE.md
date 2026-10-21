# Multiple product images — deployment update

Each product supports eight images. The first is the cover. Authorized staff (admin, manager, procurement) can upload multiple selected files, replace a picture in place, remove pictures, reorder them and select a new cover. Customers/sellers can view active product galleries but cannot change them. Inactive product images are available only to image-management roles through authenticated requests. Existing products work with an empty gallery. Create a product first, then choose Products > Manage images.

## Storage and processing

Images and thumbnails are stored as binary MongoDB ProductImage records, with metadata references in Product.images. No filesystem persistence, Cloudinary account or storage API key is required. Images consume your Atlas storage quota. Back up product metadata and productimages together. Original input bytes and original filenames are not retained.

Accept JPG/PNG/WebP, up to 3 MiB and 12 megapixels per input. Animated images, SVG and other formats are rejected. The server checks signatures and declared MIME, decodes, auto-orients and re-encodes to WebP (maximum 1600 by 1600, maximum 1 MiB), stripping original metadata, and creates a 320-pixel thumbnail. This is raster normalization, not a ClamAV scan. It is separate from disabled document uploads and does not enable receipts or document downloads.

Processing is serialized per process with a small bounded waiting queue. MongoDB transactions atomically update bytes, references and audit entries. Product versions reject stale/concurrent edits instead of silently replacing another user's changes. Deleted/replaced bytes are removed transactionally. Public images cache for five minutes and are not private documents. No production load test on a 512 MB instance or actual browser visual test has been performed.

## Backend deployment

Copy the following files into your existing repository, preserving .env and real secrets:

- src/app.js
- src/validation.js
- src/modules/catalog/catalog.model.js
- src/modules/catalog/catalog.validation.js
- src/modules/catalog/product-images.routes.js (new)
- src/modules/catalog/product-images.service.js (new)
- src/modules/platform/idempotency.middleware.js
- package.json and package-lock.json
- tests/product-images.test.js

If the preceding Vercel adapter update is not installed, also copy its files listed in VERCEL_SETUP.md. Run npm ci, npm run format:check, npm run check and npm test, then commit and push. Deploy the backend first. Keep DOCUMENT_UPLOADS_ENABLED=false on Vercel. No extra environment variables, paid disk or manual migration are needed. The existing server startup creates the new collection indexes; images use the current MongoDB URI.

## Frontend deployment

Copy these frontend files from the companion updated frontend ZIP:

- src/modules/catalog/ProductImages.jsx (new)
- src/modules/catalog/module.js
- src/modules/public/PublicSite.jsx
- src/Workspace.jsx
- src/shared/DataTable.jsx
- src/shared/translations.js
- app/globals.css
- scripts/serve.mjs (for local/self-hosted proxy header forwarding)
- next.config.mjs (preserves Vercel API rewrites and local static export)
- tests/ui.test.jsx and tests/backend.integration.js

Keep your frontend BACKEND_URL pointed at the actual working backend origin; NEXT_PUBLIC_API_URL remains /api. Run npm run test:ui, npm test and npm run build, commit and push to deploy Vercel.

## How to use

Open Products as authorized staff, choose Manage images next to a product, select several files, review previews and click Upload selected. Uploads are sequential and each successful image is retained if a later file fails. Make cover puts a picture first. Arrow buttons change order. Replace accepts one file and swaps only that picture. Remove asks for confirmation. Table thumbnails, cards, public galleries and product details display stored images. A larger gallery opens from View images. No fake product photos are seeded.

## API

- GET /api/products/:id/images — current product metadata, staff only.
- POST /api/products/:id/images — raw JPG/PNG/WebP body; Content-Type and X-Product-Version headers required. Returns 201 {product}.
- POST /api/products/:id/images/:imageId/replace — same raw upload headers, returns 200 {product}. Replacement gets a new image ID to avoid stale cache URLs.
- PATCH /api/products/:id/images — JSON {version, imageIds}; include every existing image ID exactly once, in the desired order. Returns {product}.
- POST /api/products/:id/images/:imageId/remove — JSON {version}, returns {product}.
- GET /api/catalog/:id/images/:imageId — public active-product WebP bytes; append /thumb for the thumbnail.
- GET /api/products/:id/images/:imageId — authenticated staff bytes, including inactive products; append /thumb for the thumbnail.

Use product.__v as the version. On 409, reload metadata before deciding to retry. Uploads are not automatically repeated after network errors. Generic product patch cannot inject image references.
