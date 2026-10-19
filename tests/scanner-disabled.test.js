import test from "node:test";
import assert from "node:assert/strict";
import {
  scanOne,
  startScannerWorker,
} from "../src/modules/documents/scanner.worker.js";

test("disabled scanner performs no database work even without a connection", async () => {
  const config = { documentUploadsEnabled: false };
  assert.equal(await scanOne(config), false);
  const stop = startScannerWorker(config);
  assert.equal(typeof stop, "function");
  stop();
});
