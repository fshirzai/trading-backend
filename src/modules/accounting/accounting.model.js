import { model, Schema } from "../../shared/model.js";
export const Journal = model("Journal", {
  closing: { type: Boolean, default: false },
  memo: { type: String, required: true },
  reference: { type: String, required: true, unique: true },
  order: { type: Schema.Types.ObjectId, ref: "Order" },
  lines: [{ account: String, debitCents: Number, creditCents: Number }],
  postedBy: { type: Schema.Types.ObjectId, ref: "User" },
  reversalOf: { type: Schema.Types.ObjectId, ref: "Journal" },
});

export const AccountingPeriod = model("AccountingPeriod", {
  month: { type: String, unique: true, required: true },
  closedBy: { type: Schema.Types.ObjectId, ref: "User" },
  closedAt: Date,
});
Journal.schema.index({ "lines.account": 1, createdAt: 1 });
export const Account = model("Account", {
  code: { type: String, unique: true },
  name: { type: String, unique: true },
  type: {
    type: String,
    enum: ["asset", "liability", "equity", "income", "expense"],
  },
  active: { type: Boolean, default: true },
});
export const Expense = model("Expense", {
  category: String,
  amountCents: Number,
  memo: String,
  order: { type: Schema.Types.ObjectId, ref: "Order" },
  reference: { type: String, unique: true },
});
export const FiscalClose = model("FiscalClose", {
  year: { type: Number, unique: true },
  profitCents: Number,
  closedBy: { type: Schema.Types.ObjectId, ref: "User" },
  closedAt: Date,
});
