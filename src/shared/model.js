import mongoose from "mongoose";
export const { Schema } = mongoose;
const options = {
  timestamps: true,
  strict: "throw",
  optimisticConcurrency: true,
};
export const model = (name, fields, indexes = []) => {
  const s = new Schema(fields, options);
  for (const index of indexes) s.index(...index);
  if (["Journal", "Audit", "Movement", "Invoice"].includes(name)) {
    s.pre("save", function () {
      if (!this.isNew) throw new Error("Append-only record cannot be modified");
    });
    for (const op of [
      "updateOne",
      "updateMany",
      "findOneAndUpdate",
      "deleteOne",
      "deleteMany",
      "findOneAndDelete",
      "replaceOne",
    ])
      s.pre(op, function () {
        throw new Error("Append-only record cannot be changed");
      });
  }
  return mongoose.model(name, s);
};
