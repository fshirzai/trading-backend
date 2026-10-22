// Consistent MongoDB snapshot, including media and receipt binaries; no secrets in archive metadata.
import mongoose from "mongoose";
import { createWriteStream, createReadStream } from "node:fs";
import { writeFile, unlink, stat } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { createHash } from "node:crypto";
import path from "node:path";
import { readConfig } from "../src/config.js";
const config = readConfig(),
  file = path.resolve(
    process.argv[2] ||
      `backup-${new Date().toISOString().replaceAll(":", "-")}.jsonl.gz`,
  );
if (config.documentUploadsEnabled)
  throw Error(
    "This backup covers MongoDB only. Disable filesystem uploads or arrange a coordinated separate backup of UPLOAD_DIR before using it.",
  );
await mongoose.connect(config.mongoUri);
const db = mongoose.connection.db,
  s = await mongoose.startSession(),
  gzip = createGzip(),
  out = createWriteStream(file, { flags: "wx", mode: 0o600 });
gzip.pipe(out);
const done = once(out, "finish");
gzip.on("error", (e) => out.destroy(e));
const write = async (x) => {
  if (!gzip.write(mongoose.mongo.BSON.EJSON.stringify(x) + "\n"))
    await once(gzip, "drain");
};
try {
  const collections = (
    await db.listCollections({ type: "collection" }).toArray()
  ).filter((c) => !c.name.startsWith("system."));
  const indexes = {};
  for (const c of collections)
    indexes[c.name] = await db.collection(c.name).indexes();
  await write({
    kind: "header",
    version: 1,
    database: db.databaseName,
    createdAt: new Date(),
    indexes,
  });
  s.startTransaction({
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
  });
  const counts = {};
  for (const c of collections) {
    counts[c.name] = 0;
    for await (const doc of db
      .collection(c.name)
      .find({}, { session: s })
      .sort({ _id: 1 })) {
      await write({ kind: "document", collection: c.name, doc });
      counts[c.name]++;
    }
  }
  await s.commitTransaction();
  await write({ kind: "footer", counts });
  gzip.end();
  await done;
  const digest = createHash("sha256");
  for await (const b of createReadStream(file)) digest.update(b);
  await writeFile(file + ".sha256", digest.digest("hex") + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({ file, bytes: (await stat(file)).size, counts }));
} catch (e) {
  await s.abortTransaction().catch(() => {});
  gzip.destroy();
  out.destroy();
  await unlink(file).catch(() => {});
  throw e;
} finally {
  await s.endSession();
  await mongoose.disconnect();
}
