import { SystemSettings } from "./settings.model.js";
export async function publicSettings(session) {
  const s =
    (await SystemSettings.findById("company")
      .session(session || null)
      .lean()) || new SystemSettings().toObject();
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
    ].map((k) => [k, s[k] ?? (k === "revision" ? 0 : "")]),
  );
}
