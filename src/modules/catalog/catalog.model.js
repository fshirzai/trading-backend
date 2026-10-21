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
  images: {
    type: [
      new Schema(
        {
          id: { type: String, required: true },
          width: Number,
          height: Number,
          size: Number,
        },
        { _id: false },
      ),
    ],
    default: [],
  },
});
Product.schema.index({ active: 1, _id: -1 });
export const ProductImage = model("ProductImage", {
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
    index: true,
  },
  data: { type: Buffer, required: true, select: false },
  thumbnail: { type: Buffer, required: true, select: false },
  mime: { type: String, enum: ["image/webp"], default: "image/webp" },
});
