import { model, Schema } from "../../shared/model.js";
export const Product = model("Product", {
  name: { en: String, ps: String, fa: String },
  sku: { type: String, uppercase: true, trim: true },
  category: String,
  video: { type: Schema.Types.ObjectId, ref: "ProductVideo" },
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

export const ProductVideo = model("ProductVideo", {
  product: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
    index: true,
  },
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  size: Number,
  mime: String,
  received: { type: Number, default: 0 },
  chunks: { type: Number, default: 0 },
  state: { type: String, enum: ["Uploading", "Ready"], default: "Uploading" },
});
export const ProductVideoChunk = model(
  "ProductVideoChunk",
  {
    video: { type: Schema.Types.ObjectId, ref: "ProductVideo", required: true },
    ordinal: Number,
    data: { type: Buffer, required: true, select: false },
  },
  [[{ video: 1, ordinal: 1 }, { unique: true }]],
);

Product.schema.index(
  { sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string" } } },
);
