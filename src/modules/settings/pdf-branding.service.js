import sharp from "sharp";
import { SystemSettings, CompanyLogo } from "./settings.model.js";
export async function drawCompanyHeader(pdf, config = {}) {
  const settings = await SystemSettings.findById("company")
    .select("name logoVersion")
    .lean();
  if (settings?.logoVersion) {
    const logo = await CompanyLogo.findById("company").select("+data").lean();
    if (logo?.data) {
      const bytes = Buffer.from(logo.data.buffer || logo.data);
      const png = await sharp(bytes)
        .resize({
          width: 180,
          height: 70,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      pdf.image(png, 45, 40, { fit: [180, 70] });
      pdf.y = 120;
    }
  }
  pdf
    .fontSize(24)
    .text(settings?.name || config.emailBrandName || "Trading Company");
}
