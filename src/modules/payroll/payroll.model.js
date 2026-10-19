import { model, Schema } from "../../shared/model.js";
export const Employee = model("Employee", {
  name: { type: String, required: true },
  job: String,
  salaryCents: { type: Number, required: true },
  advanceCents: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});

export const Salary = model(
  "Salary",
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: String, required: true },
    grossCents: Number,
    deductionCents: Number,
    netCents: Number,
  },
  [[{ employee: 1, month: 1 }, { unique: true }]],
);
