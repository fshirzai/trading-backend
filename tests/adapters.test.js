import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { clamScan } from "../src/modules/documents/scanner.service.js";
import { parseStatement } from "../src/modules/reconciliation/reconciliation.service.js";
import { encrypt, decrypt } from "../src/shared/encryption.js";
test("encrypted sensitive data rejects a modified ciphertext", () => {
  const key = Buffer.alloc(32, 7),
    sealed = encrypt("sensitive-token", key);
  assert.equal(decrypt(sealed, key), "sensitive-token");
  const parts = sealed.split(".");
  parts[1] = Buffer.alloc(16, 0).toString("base64");
  assert.throws(() => decrypt(parts.join("."), key));
});
test("statement parser rejects duplicate references, hidden fractions and invalid dates", () => {
  assert.equal(
    parseStatement("date,reference,amount\n2026-10-14,A,-10.50")[0].amountCents,
    -1050,
  );
  for (const csv of [
    "date,reference,amount\n2026-10-14,A,1.001",
    "date,reference,amount\n2026-02-30,A,10",
    "date,reference,amount\n2026-10-14,A,10\n2026-10-14,A,20",
  ])
    assert.throws(() => parseStatement(csv));
});
test("ClamAV adapter streams real framed bytes and rejects scanner failures", async () => {
  let expected = Buffer.alloc(0);
  const server = net.createServer((socket) => {
    let raw = Buffer.alloc(0);
    socket.on("data", (b) => {
      raw = Buffer.concat([raw, b]);
      const prefix = Buffer.from("zINSTREAM\0");
      if (raw.length < prefix.length) return;
      assert.equal(raw.subarray(0, prefix.length).toString(), "zINSTREAM\0");
      let offset = prefix.length;
      const chunks = [];
      while (raw.length >= offset + 4) {
        const size = raw.readUInt32BE(offset);
        if (!size) {
          expected = Buffer.concat(chunks);
          socket.end("stream: OK\0");
          return;
        }
        if (raw.length < offset + 4 + size) return;
        chunks.push(raw.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const bytes = Buffer.alloc(150000, 42),
      result = await clamScan(bytes, {
        clamHost: "127.0.0.1",
        clamPort: server.address().port,
      });
    assert.equal(result.clean, true);
    assert.deepEqual(expected, bytes);
  } finally {
    await new Promise((r) => server.close(r));
  }
  await assert.rejects(() => clamScan(Buffer.from("a"), {}));
});

test("SMTP adapter enforces TLS and disables file/URL attachment access", async () => {
  const { createMailer } =
    await import("../src/modules/email/email.service.js");
  let options, mail;
  const config = {
    mode: "test",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpUser: "user",
    smtpPassword: "test-secret",
    mailFrom: "sender@example.test",
    transportFactory: (opts) => {
      options = opts;
      return {
        sendMail: async (x) => {
          mail = x;
        },
        verify: async () => true,
      };
    },
  };
  const client = createMailer(config);
  await client.verify();
  await client.send({
    to: "recipient@example.test",
    subject: "Test",
    text: "Body",
  });
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(mail.from, config.mailFrom);
});

test("USD provider adapter builds checkout/refund requests and verifies signed raw events", async () => {
  const { gateway } =
    await import("../src/modules/payments/gateway.service.js");
  const { default: Stripe } = await import("stripe");
  const sdk = new Stripe("sk_test_fixture");
  let created, refunded;
  const config = {
    mode: "test",
    gatewayProvider: "stripe",
    gatewayApproved: true,
    stripeKey: "sk_test_fixture",
    stripeWebhookSecret: "whsec_fixture",
    frontendUrl: "https://merchant.example",
    stripeClient: {
      checkout: {
        sessions: {
          create: async (data, opts) => {
            created = { data, opts };
            return {
              id: "cs_fixture",
              url: "https://checkout.example/session",
            };
          },
        },
      },
      webhooks: sdk.webhooks,
      refunds: {
        create: async (data, opts) => {
          refunded = { data, opts };
          return { id: "re_fixture", status: "succeeded" };
        },
        retrieve: async (id) => ({ id, status: "succeeded" }),
      },
    },
  };
  const client = gateway(config);
  await client.create(
    { id: "attempt", key: "retry-key", amountCents: 10000 },
    { id: "order" },
  );
  assert.equal(created.data.line_items[0].price_data.currency, "usd");
  assert.equal(created.data.line_items[0].price_data.unit_amount, 10000);
  assert.equal(created.opts.idempotencyKey, "retry-key");
  const payload = JSON.stringify({
      id: "evt_fixture",
      type: "checkout.session.completed",
      data: { object: {} },
    }),
    signature = sdk.webhooks.generateTestHeaderString({
      payload,
      secret: config.stripeWebhookSecret,
    });
  assert.equal(
    client.verify(Buffer.from(payload), signature).id,
    "evt_fixture",
  );
  assert.throws(() => client.verify(Buffer.from(payload + " "), signature));
  await client.refund("pi_fixture", 7500, "refund-key");
  assert.equal(refunded.data.amount, 7500);
  assert.equal(refunded.opts.idempotencyKey, "refund-key");
  assert.equal((await client.retrieveRefund("re_fixture")).status, "succeeded");
});
