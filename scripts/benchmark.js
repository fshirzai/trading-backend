import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import * as M from "../src/models.js";
import { readConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/modules/auth/password.service.js";
const r = await MongoMemoryReplSet.create({
  replSet: {
    count: 1,
    args: process.platform === "win32" ? [] : ["--nounixsocket"],
  },
});
try {
  await mongoose.connect(r.getUri(), { maxPoolSize: 20 });
  for (const m of Object.values(M)) await m.init();
  const c = readConfig({
      NODE_ENV: "test",
      MONGODB_URI: r.getUri(),
      JWT_SECRET: "b".repeat(64),
    }),
    app = await createApp(c);
  await M.User.create({
    name: "Benchmark",
    email: "bench@example.com",
    role: "admin",
    emailVerified: true,
    passwordHash: await hashPassword("Benchmark-Test-Password", 16384),
  });
  await M.Product.insertMany(
    Array.from({ length: 10000 }, (_, i) => ({
      name: { en: "Product " + i },
      active: true,
    })),
  );
  const l = await request(app)
    .post("/api/auth/login")
    .send({ email: "bench@example.com", password: "Benchmark-Test-Password" });
  if (l.status !== 200) throw Error("Benchmark login failed");
  const times = [],
    start = performance.now();
  for (let batch = 0; batch < 20; batch++)
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        const t = performance.now();
        await request(app)
          .get("/api/records/product?limit=25")
          .set("Authorization", "Bearer " + l.body.accessToken)
          .expect(200);
        times.push(performance.now() - t);
      }),
    );
  times.sort((a, b) => a - b);
  const elapsed = performance.now() - start;
  const explain = await M.Product.find({ active: true })
    .sort({ _id: -1 })
    .limit(25)
    .explain("executionStats");
  const report = {
    scope: "Local smoke benchmark, not production capacity validation",
    dataset: 10000,
    requests: 100,
    concurrency: 5,
    p50ms: +times[49].toFixed(2),
    p95ms: +times[94].toFixed(2),
    requestsPerSecond: +(100 / (elapsed / 1000)).toFixed(2),
    catalogKeysExamined: explain.executionStats.totalKeysExamined,
    catalogDocsExamined: explain.executionStats.totalDocsExamined,
  };
  await writeFile("BENCHMARK.json", JSON.stringify(report, null, 2) + "\n");
  console.log(report);
} finally {
  await mongoose.disconnect();
  await r.stop();
}
