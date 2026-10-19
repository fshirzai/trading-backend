import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import handlerExport from "../src/app.js";
import { createVercelHandler } from "../src/modules/platform/vercel-handler.js";
import { drainEmailJobs } from "../src/modules/email/serverless-email.service.js";

const response = () =>
  Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
  });
test("Vercel entrypoint exports a request function without starting a server on import", () => {
  assert.equal(typeof handlerExport, "function");
});
test("concurrent requests share initialization and failed initialization can be retried", async () => {
  let initialized = 0,
    calls = 0;
  const handler = createVercelHandler({
    initialize: async () => {
      initialized++;
      return { app: () => calls++, config: {} };
    },
    waitUntil: () => assert.fail("GET should not schedule mail"),
  });
  await Promise.all([
    handler({ method: "GET", url: "/api/health/ready" }, response()),
    handler({ method: "GET", url: "/api/catalog" }, response()),
  ]);
  assert.equal(initialized, 1);
  assert.equal(calls, 2);
  let attempts = 0;
  const retry = createVercelHandler({
    initialize: async () => {
      if (++attempts === 1) throw Error("temporary connection failure");
      return { app: () => {}, config: {} };
    },
  });
  await assert.rejects(retry({ method: "GET", url: "/" }, response()));
  await retry({ method: "GET", url: "/" }, response());
  assert.equal(attempts, 2);
});
test("email work is registered before dispatch, runs after successful response and skips failed responses", async () => {
  for (const status of [201, 422]) {
    let task,
      delivered = 0;
    const res = response();
    const handler = createVercelHandler({
      initialize: async () => ({
        app: () => {
          assert.ok(task);
        },
        config: {},
      }),
      waitUntil: (promise) => {
        task = promise;
      },
      drainEmails: async () => {
        delivered++;
      },
    });
    await handler({ method: "POST", url: "/api/auth/register/" }, res);
    assert.equal(delivered, 0);
    res.statusCode = status;
    res.writableFinished = true;
    res.emit("finish");
    await task;
    assert.equal(delivered, status === 201 ? 1 : 0);
  }
});
test("client disconnect does not start email work for an incomplete response", async () => {
  let task;
  const res = response();
  const handler = createVercelHandler({
    initialize: async () => ({ app: () => {}, config: {} }),
    waitUntil: (promise) => {
      task = promise;
    },
    drainEmails: () => assert.fail("incomplete request"),
  });
  await handler({ method: "POST", url: "/api/auth/forgot-password" }, res);
  res.emit("close");
  await task;
});
test("serverless mail drain respects retry delay, stops when empty and bounds work", async () => {
  let time = 0,
    attempts = 0;
  const processed = await drainEmailJobs(
    {},
    {
      deliver: async () => ++attempts !== 2,
      nextJob: async () => ({ availableAt: new Date(2000) }),
      now: () => time,
      pause: async (ms) => {
        time += ms;
      },
      maxJobs: 2,
    },
  );
  assert.equal(processed, 2);
  assert.equal(time, 2000);
  assert.equal(
    await drainEmailJobs(
      {},
      { deliver: async () => false, nextJob: async () => null },
    ),
    0,
  );
  assert.equal(
    await drainEmailJobs(
      {},
      {
        deliver: async () => false,
        nextJob: async () => ({ availableAt: new Date(100000) }),
        now: () => 0,
        pause: () => assert.fail("wait exceeds request budget"),
      },
    ),
    0,
  );
});
