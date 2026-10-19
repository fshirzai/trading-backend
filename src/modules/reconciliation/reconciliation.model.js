import { model, Schema } from "../../shared/model.js";
export const BankStatement = model("BankStatement", {
  name: String,
  account: { type: String, enum: ["Bank", "Cash"], required: true },
  sha256: { type: String, unique: true, required: true },
  openingCents: Number,
  closingCents: Number,
  status: { type: String, default: "Open" },
  closedAt: Date,
  closedBy: { type: Schema.Types.ObjectId, ref: "User" },
});
export const BankLine = model(
  "BankLine",
  {
    statement: {
      type: Schema.Types.ObjectId,
      ref: "BankStatement",
      required: true,
    },
    date: Date,
    reference: String,
    amountCents: Number,
    journal: { type: Schema.Types.ObjectId, ref: "Journal" },
    matchedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  [
    [{ statement: 1, reference: 1 }, { unique: true }],
    [
      { journal: 1 },
      {
        unique: true,
        partialFilterExpression: { journal: { $type: "objectId" } },
      },
    ],
  ],
);
