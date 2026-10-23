import { model, Schema } from "../../shared/model.js";
export const SystemSettings = model("SystemSettings", {
  _id: { type: String, default: "company" },
  name: { type: String, default: "Shirzai Trading" },
  tagline: {
    type: String,
    default: "Agricultural products. Wholesale supply.",
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
          "موږ د کرنیزو محصولاتو د عمده پېر او پلور چارې اسانه کوو. تاسو کولای شئ د محصولاتو مشخصات او انځورونه وګورئ، د خپلې اړتیا اندازه وټاکئ او د بیې غوښتنه وکړئ. د فرمایش تر تایید مخکې به بیه، د تادیې شرایط او د سپارلو ځای درسره روښانه شي.",
      },
      fa: {
        aboutTitle: "دربارهٔ ما",
        aboutBody:
          "ما خرید و فروش عمدهٔ محصولات زراعتی را آسان می‌سازیم. شما می‌توانید مشخصات و تصاویر محصولات را ببینید، مقدار مورد نیاز خود را انتخاب کنید و نرخ بخواهید. پیش از تأیید سفارش، قیمت، شرایط پرداخت و محل تحویل با شما مشخص می‌شود.",
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
