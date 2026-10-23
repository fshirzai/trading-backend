import { model, Schema } from "../../shared/model.js";
export const SystemSettings = model("SystemSettings", {
  _id: { type: String, default: "company" },
  name: { type: String, default: "Shirzai Trading" },
  tagline: {
    type: String,
    default: "Good origins. Clear agreements. Connected trade.",
  },
  aboutTitle: { type: String, default: "About our company" },
  aboutBody: { type: String, default: "" },
  contactEmail: { type: String, default: "" },
  contactPhone: { type: String, default: "" },
  address: { type: String, default: "" },
  workingHours: { type: String, default: "" },
  website: { type: String, default: "" },
  logoVersion: String,
  revision: { type: Number, default: 0 },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
});
export const CompanyLogo = model("CompanyLogo", {
  _id: { type: String, default: "company" },
  data: { type: Buffer, required: true, select: false },
  mime: { type: String, default: "image/webp" },
});
