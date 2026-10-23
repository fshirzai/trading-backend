import { SystemSettings } from "./settings.model.js";
export async function publicSettings(session) {
  const stored =
    (await SystemSettings.findById("company")
      .session(session || null)
      .lean()) || new SystemSettings().toObject();
  const s = { ...new SystemSettings().toObject(), ...stored };
  if (s.tagline === "Good origins. Clear agreements. Connected trade.")
    s.tagline = new SystemSettings().tagline;
  if (!s.aboutBody?.trim()) s.aboutBody = new SystemSettings().aboutBody;
  return Object.fromEntries(
    [
      "name",
      "tagline",
      "aboutTitle",
      "aboutBody",
      "contactEmail",
      "contactPhone",
      "address",
      "workingHours",
      "website",
      "logoVersion",
      "revision",
      "aboutImages",
      "translations",
      "termsBody",
      "privacyBody",
      "deliveryBody",
    ].map((k) => [k, s[k] ?? (k === "revision" ? 0 : "")]),
  );
}

export async function adminSettings(session) {
  const result = await publicSettings(session);
  const stored = await SystemSettings.findById("company")
    .select("invoiceProfile")
    .session(session || null)
    .lean();
  return { ...result, invoiceProfile: stored?.invoiceProfile || {} };
}
