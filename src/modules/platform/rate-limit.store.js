import mongoose from "mongoose";
export class MongoRateStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  async increment(key) {
    const bucket = Math.floor(Date.now() / this.windowMs),
      expiresAt = new Date((bucket + 1) * this.windowMs);
    const doc = await mongoose.connection
      .collection("rate_limits")
      .findOneAndUpdate(
        { _id: `${this.prefix}:${bucket}:${key}` },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, returnDocument: "after" },
      );
    return { totalHits: doc.count, resetTime: expiresAt };
  }
  async decrement(key) {
    const bucket = Math.floor(Date.now() / this.windowMs);
    await mongoose.connection
      .collection("rate_limits")
      .updateOne(
        { _id: `${this.prefix}:${bucket}:${key}`, count: { $gt: 0 } },
        { $inc: { count: -1 } },
      );
  }
  async resetKey(key) {
    const bucket = Math.floor(Date.now() / this.windowMs);
    await mongoose.connection
      .collection("rate_limits")
      .deleteOne({ _id: `${this.prefix}:${bucket}:${key}` });
  }
}
