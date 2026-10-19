import test from "node:test";
import assert from "node:assert/strict";
import { accountEmail } from "../src/modules/email/account-email.template.js";
import { readConfig } from "../src/config.js";

for (const kind of ["verify", "reset"]) {
  test(`${kind} email includes its action, expiry and matching HTML/plain-text links`, () => {
    const actionUrl = `https://trading.example/${kind === "verify" ? "verify-email" : "reset-password"}?token=abc123&source=email`;
    const result = accountEmail({ kind, name: "Faizullah", actionUrl });
    assert.match(
      result.subject,
      kind === "verify" ? /Verify your email/ : /Reset your password/,
    );
    assert.match(result.html, /Hello Faizullah,/);
    assert.ok(result.text.includes(actionUrl));
    assert.equal(
      (result.html.match(/href="https:\/\/trading.example\//g) || []).length,
      2,
    );
    assert.ok(result.html.includes("token=abc123&amp;source=email"));
    assert.match(result.html, /5 minutes/);
    assert.match(result.text, /5 minutes/);
    assert.match(result.text, /only once/);
    assert.match(result.html, /did not/);
    assert.doesNotMatch(result.html, /<script|<img|<form|<iframe/i);
    if (kind === "reset")
      assert.match(result.text, /password will stay unchanged/);
  });
}
test("HTML escapes account names, brand text and action URLs", () => {
  const result = accountEmail({
    kind: "verify",
    name: '<img src=x onerror="alert(1)">',
    brandName: "Beans & <Trade>",
    actionUrl: "https://trading.example/verify-email?token=abc&next=%22",
  });
  assert.doesNotMatch(result.html, /<img|<Trade>/);
  assert.match(result.html, /&lt;img/);
  assert.match(result.html, /Beans &amp; &lt;Trade&gt;/);
});
test("email rendering refuses unknown kinds and unsafe URL protocols", () => {
  assert.throws(() =>
    accountEmail({ kind: "other", actionUrl: "https://trading.example" }),
  );
  assert.throws(() =>
    accountEmail({ kind: "reset", actionUrl: "javascript:alert(1)" }),
  );
  assert.throws(() =>
    accountEmail({
      kind: "reset",
      actionUrl: "https://user:pass@trading.example",
    }),
  );
});
test("email brand configuration defaults safely and rejects multiline subjects", () => {
  const env = {
    MONGODB_URI: "mongodb://localhost/test",
    JWT_SECRET: "x".repeat(64),
  };
  assert.equal(readConfig(env).emailBrandName, "Trading Company");
  assert.equal(
    readConfig({ ...env, EMAIL_BRAND_NAME: "Company Foods" }).emailBrandName,
    "Company Foods",
  );
  assert.throws(() =>
    readConfig({
      ...env,
      EMAIL_BRAND_NAME: "Company\r\nBcc: other@example.test",
    }),
  );
});
