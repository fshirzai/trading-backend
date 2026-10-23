import { model, Schema } from "../../shared/model.js";
export const SystemSettings = model("SystemSettings", {
  _id: { type: String, default: "company" },
  name: { type: String, default: "Shirzai Trading" },
  tagline: {
    type: String,
    default: "Good origins. Clear agreements. Connected trade.",
  },
  aboutTitle: { type: String, default: "About our company" },
  aboutBody: {
    type: String,
    default:
      "We connect agricultural products with businesses that value clear specifications, careful handling and reliable communication. Explore our catalog, request a quotation, and review the agreed price, payment and handover details before accepting your order.",
  },
  aboutImages: {
    type: [new Schema({ id: String, alt: String }, { _id: false })],
    default: () => [
      { id: "starter-field", alt: "Agricultural fields" },
      { id: "starter-grain", alt: "Harvested grain" },
    ],
  },
  translations: {
    type: Schema.Types.Mixed,
    default: () => ({
      ps: {
        aboutTitle: "زموږ په اړه",
        aboutBody:
          "موږ کرنیز محصولات له هغو سوداګرو سره نښلوو چې روښانه مشخصات، سم ساتنه او باوري اړیکې ورته ارزښت لري. زموږ محصولات وګورئ، د نرخ غوښتنه وکړئ او د فرمایش تر منلو مخکې پر بیه، تادیې او سپارلو ځای هوکړه وکړئ.",
      },
      fa: {
        aboutTitle: "دربارهٔ ما",
        aboutBody:
          "ما محصولات زراعتی را به کسب‌وکارهایی پیوند می‌دهیم که مشخصات روشن، نگهداری مناسب و ارتباط قابل اعتماد برایشان اهمیت دارد. محصولات ما را ببینید، درخواست نرخ بدهید و پیش از پذیرش سفارش، قیمت، روش پرداخت و محل تحویل را بررسی کنید.",
      },
    }),
  },
  termsBody: { type: String, default: "" },
  privacyBody: { type: String, default: "" },
  deliveryBody: { type: String, default: "" },
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

export const CompanyPhoto = model("CompanyPhoto", {
  data: { type: Buffer, required: true, select: false },
  mime: { type: String, default: "image/webp" },
});
