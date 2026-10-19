import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import {
  hashPassword,
  verifyPassword,
} from "../src/modules/auth/password.service.js";
import { cents, quantitySum } from "../src/shared/rules.js";
const base = {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  MONGODB_URI: "mongodb://127.0.0.1/test",
  JWT_SECRET: "a".repeat(64),
};
test("document uploads default enabled and require an explicit boolean to disable", () => {
  assert.equal(readConfig(base).documentUploadsEnabled, true);
  assert.equal(
    readConfig({ ...base, DOCUMENT_UPLOADS_ENABLED: "false" })
      .documentUploadsEnabled,
    false,
  );
  assert.equal(
    readConfig({ ...base, DOCUMENT_UPLOADS_ENABLED: "true" })
      .documentUploadsEnabled,
    true,
  );
  assert.throws(() =>
    readConfig({ ...base, DOCUMENT_UPLOADS_ENABLED: "False" }),
  );
});
test("production rejects weak secrets, HTTP origins and unconfirmed policy", () => {
  assert.throws(() => readConfig({ ...base, JWT_SECRET: "short" }));
  assert.throws(() =>
    readConfig({
      ...base,
      NODE_ENV: "production",
      WEB_ORIGINS: "http://example.com",
      RETURN_POLICY_CONFIRMED: "true",
    }),
  );
  assert.throws(() =>
    readConfig({
      ...base,
      NODE_ENV: "production",
      WEB_ORIGINS: "https://example.com",
    }),
  );
  assert.throws(() => readConfig({ ...base, TRUST_PROXY_HOPS: "999" }));
  const c = readConfig({
    ...base,
    NODE_ENV: "production",
    WEB_ORIGINS: "https://example.com",
    RETURN_POLICY_CONFIRMED: "true",
  });
  assert.equal(c.scryptN, 131072);
});
test("production password derivation uses random salts and verifies safely", async () => {
  const a = await hashPassword("Strong-Unicode-Password-پښتو"),
    b = await hashPassword("Strong-Unicode-Password-پښتو");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("scrypt$131072$"));
  assert.equal(await verifyPassword("Strong-Unicode-Password-پښتو", a), true);
  assert.equal(await verifyPassword("Wrong-Password", a), false);
  assert.equal(await verifyPassword("Wrong-Password", "malformed"), false);
});
test("currency precision rejects hidden fractions and stock arithmetic is normalized", () => {
  assert.throws(() => cents(1.001));
  assert.equal(cents(1.01), 101);
  assert.equal(quantitySum([0.1, 0.2]), 0.3);
});
