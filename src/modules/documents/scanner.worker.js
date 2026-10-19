import { readFile } from "node:fs/promises";
import path from "node:path";
import { Document } from "./documents.model.js";
import { scanFile } from "./scanner.service.js";
import { digest } from "../../shared/encryption.js";
export async function scanOne(config) {
  const doc = await Document.findOneAndUpdate(
    {
      status: "Quarantined",
      $or: [
        { scanLockedUntil: null },
        { scanLockedUntil: { $lte: new Date() } },
      ],
    },
    { $set: { scanLockedUntil: new Date(Date.now() + 30000) } },
    { returnDocument: "after", sort: { createdAt: 1 } },
  );
  if (!doc) return false;
  try {
    const bytes = await readFile(path.join(config.uploadDir, doc.id));
    if (digest(bytes) !== doc.sha256) throw Error("Integrity failure");
    const result = await scanFile(bytes, config);
    await Document.updateOne(
      {
        _id: doc.id,
        status: "Quarantined",
        scanLockedUntil: doc.scanLockedUntil,
      },
      {
        $set: { status: result.clean ? "Clean" : "Rejected" },
        $unset: { scanLockedUntil: 1, lastScanError: 1 },
      },
    );
  } catch {
    await Document.updateOne(
      { _id: doc.id, status: "Quarantined" },
      {
        $set: {
          lastScanError: "Scan unavailable",
          scanLockedUntil: new Date(Date.now() + 60000),
        },
      },
    );
  }
  return true;
}
export function startScannerWorker(config) {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await scanOne(config);
    } catch {
      console.error(
        JSON.stringify({ level: "error", message: "Scanner worker failed" }),
      );
    } finally {
      busy = false;
    }
  }, 2000);
  t.unref();
  return () => clearInterval(t);
}
