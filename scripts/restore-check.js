// Restore only into a fresh, explicitly named verification database. Never overwrites an existing database.
import mongoose from "mongoose";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { readConfig } from "../src/config.js";
const file = process.argv[2],
  target = process.env.RESTORE_DATABASE;
if (!file || !/^trading_restore_[a-zA-Z0-9_]+$/.test(target || ""))
  throw Error(
    "Pass backup path and set RESTORE_DATABASE=trading_restore_UNIQUE_NAME",
  );
const expected = (await readFile(file + ".sha256", "utf8")).trim(),
  hash = createHash("sha256");
for await (const b of createReadStream(file)) hash.update(b);
if (hash.digest("hex") !== expected) throw Error("Backup checksum mismatch");
await mongoose.connect(readConfig().mongoUri);
const db = mongoose.connection.client.db(target);
try {
  if ((await db.listCollections().toArray()).length)
    throw Error(
      "Restore target must be empty; existing data will not be overwritten",
    );
  let header, footer;
  const counts = {};
  const stream = createReadStream(file).pipe(createGunzip());
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  stream.on("error", (e) => reader.close());
  for await (const line of reader) {
    const row = mongoose.mongo.BSON.EJSON.parse(line);
    if (row.kind === "header") {
      if (header || row.version !== 1 || row.database === target)
        throw Error("Invalid backup header");
      header = row;
    } else if (row.kind === "document") {
      if (!header || footer || !Object.hasOwn(header.indexes, row.collection))
        throw Error("Invalid backup order");
      await db.collection(row.collection).insertOne(row.doc);
      counts[row.collection] = (counts[row.collection] || 0) + 1;
    } else if (row.kind === "footer") footer = row;
    else throw Error("Unknown backup record");
  }
  if (!header || !footer) throw Error("Incomplete backup");
  for (const [name, count] of Object.entries(footer.counts)) {
    if ((counts[name] || 0) !== count)
      throw Error("Restore count mismatch: " + name);
    if (!count) await db.createCollection(name);
    for (const i of header.indexes[name] || []) {
      if (i.name === "_id_" || i.expireAfterSeconds !== undefined) continue;
      const {
        key,
        name: inm,
        unique,
        sparse,
        partialFilterExpression,
        collation,
      } = i;
      await db.collection(name).createIndex(key, {
        name: inm,
        ...(unique ? { unique } : {}),
        ...(sparse ? { sparse } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
        ...(collation ? { collation } : {}),
      });
    }
  }
  const invalid = await db.collection("batches").countDocuments({
    $or: [
      { quantity: { $lt: 0 } },
      { reservedQuantity: { $lt: 0 } },
      {
        $expr: { $gt: [{ $ifNull: ["$reservedQuantity", 0] }, "$quantity"] },
      },
    ],
  });
  if (invalid) throw Error("Restored inventory invariant failed");
  console.log(
    JSON.stringify({
      verified: true,
      database: target,
      counts: footer.counts,
      note: "Verification database retained. TTL indexes intentionally omitted so expired evidence remains inspectable. This is not a production restore.",
    }),
  );
} finally {
  await mongoose.disconnect();
}
