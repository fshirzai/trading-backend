import mongoose from "mongoose";
import { readConfig } from "./config.js";
import { User } from "./models.js";
import { hashPassword } from "./modules/auth/password.service.js";
const config = readConfig();
const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD } = process.env;
if (
  !ADMIN_EMAIL ||
  !ADMIN_NAME ||
  !ADMIN_PASSWORD ||
  ADMIN_PASSWORD.length < 12 ||
  Buffer.byteLength(ADMIN_PASSWORD) > 256
)
  throw Error(
    "Set ADMIN_EMAIL, ADMIN_NAME and a strong 12+ character ADMIN_PASSWORD",
  );
await mongoose.connect(config.mongoUri);
try {
  await User.init();
  if (await User.exists({ role: "admin" }))
    throw Error("Administrator already exists; bootstrap refused");
  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL.trim().toLowerCase(),
    emailVerified: true,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: "admin",
  });
  console.log("Administrator created; remove bootstrap credentials from .env");
} finally {
  await mongoose.disconnect();
}
