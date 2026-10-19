import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { RuleError } from "../../shared/rules.js";
const derive = promisify(scrypt);
let running = 0;
const waiting = [];
async function limited(fn) {
  if (running >= 2) {
    if (waiting.length >= 10)
      throw new RuleError("Authentication busy; try again shortly", 503);
    await new Promise((r) => waiting.push(r));
  } else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}
export async function hashPassword(password, N = 131072) {
  const salt = randomBytes(16).toString("hex");
  const key = await limited(() =>
    derive(password, salt, 64, { N, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }),
  );
  return `scrypt$${N}$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  const [algorithm, n, salt, hash] = stored.split("$");
  const N = Number(n);
  if (
    algorithm !== "scrypt" ||
    ![16384, 131072].includes(N) ||
    !/^[a-f\d]{32}$/.test(salt) ||
    !/^[a-f\d]{128}$/.test(hash)
  )
    return false;
  const key = await limited(() =>
    derive(password, salt, 64, { N, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }),
  );
  return timingSafeEqual(key, Buffer.from(hash, "hex"));
}
