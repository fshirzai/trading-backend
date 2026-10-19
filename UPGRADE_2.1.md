# Upgrade existing local backend to 2.1

Keep your existing `.env`, database and `var/uploads` directory. Copy the updated `src/` directory from this package over your current backend `src/` directory. Include the new `src/modules/workspace/` folder. Restart `npm run dev`. No database reset or migration is required.

The additions are read endpoints and display metadata used by the frontend. Dependencies and existing payment, stock and return rules remain unchanged. Copy `tests/` if you want the new permission tests locally. A fresh checkout can instead use `npm ci` with the included package/lock files.
