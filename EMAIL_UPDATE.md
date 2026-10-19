# Verification and password-reset email update

Copy these three files from this package to the same relative paths in your existing backend repository:

- src/config.js
- src/modules/email/email.service.js
- src/modules/email/account-email.template.js (new)

The automated tests are in tests/email-template.test.js. Copy that file too to include the new regression tests in CI. Existing deployment settings, SMTP credentials, JWT secret and encryption key should be preserved. No dependency installation or database migration is required.

Set optional EMAIL_BRAND_NAME in Render to your company display name. Default: Trading Company. MAIL_FROM still needs to match your verified sender.

Run npm run format:check and npm test, then commit the updated source and tests and push. Render will deploy the new commit. Request a new verification or password-reset email after deployment: email bodies already in the outbox are not rewritten.

Open docs/email-previews/verify.html and reset.html locally to review the layouts. These contain dummy, nonfunctional links. No real user email has been sent by this update. Test actual Gmail/Outlook appearance and delivery after deployment.
