import { decrypt } from "../../shared/encryption.js";
import { RuleError, requireRule } from "../../shared/rules.js";
export const hesabBase = (environment) =>
  environment === "production"
    ? "https://api.hesab.com"
    : "https://api-sandbox.hesab.com";
export const convertAfn = (usdCents, rateMicros) => {
  const value = (BigInt(usdCents) * BigInt(rateMicros) + 500000n) / 1000000n;
  requireRule(value <= BigInt(Number.MAX_SAFE_INTEGER), "Amount too large");
  return Number(value);
};
export async function hesabRequest(account, path, body, config) {
  const key = decrypt(account.apiKeyCipher, config.encryptionKey);
  let response;
  try {
    response = await (
      config.mode === "test" && config.hesabFetch ? config.hesabFetch : fetch
    )(hesabBase(account.environment) + path, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "API-KEY " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new RuleError(
      "HesabPay could not be reached; retry with the same request",
      503,
    );
  }
  if (!response.ok)
    throw new RuleError(
      "HesabPay rejected the request; check merchant configuration",
      502,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new RuleError("Invalid HesabPay response", 502);
  }
  return data;
}
