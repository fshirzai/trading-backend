import { model, Schema } from "../../shared/model.js";
export const Party = model("Party", {
  name: { type: String, required: true },
  type: { type: String, enum: ["customer", "supplier"], required: true },
  country: String,
  email: String,
  phone: String,
  address: String,
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
});
