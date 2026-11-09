function parseSecurePortalUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    let url: URL;
    if (/^https?:\/\//i.test(raw)) {
      url = new URL(raw);
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//")) return "";
      url = new URL(`https://${raw}`);
    }
    return url.protocol === "https:" && url.hostname ? url.href : "";
  } catch {
    return "";
  }
}

export function resolveBankPortalUrl(entryUrl: unknown, defaultUrl: unknown): string {
  return parseSecurePortalUrl(entryUrl) || parseSecurePortalUrl(defaultUrl);
}
