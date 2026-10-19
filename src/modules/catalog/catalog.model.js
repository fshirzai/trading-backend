import { model, Schema } from "../../shared/model.js";
export const Product = model("Product", {
  name: { en: String, ps: String, fa: String },
  category: String,
  grade: String,
  origin: String,
  packaging: String,
  unit: { type: String, default: "tonne" },
  moq: { type: Number, min: 0 },
  active: { type: Boolean, default: true },
});
Product.schema.index({ active: 1, _id: -1 });
