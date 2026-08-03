const OFFICIAL_HOSTS = new Set(["ra-training.com", "www.ra-training.com"]);

function validHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function officialLanding(value: string | null | undefined): string | undefined {
  const parsed = validHttpUrl(value);
  if (!parsed) return undefined;
  return OFFICIAL_HOSTS.has(new URL(parsed).hostname) ? parsed : undefined;
}

function optionalParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

export type LeadAttribution = {
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingUrl?: string;
  referrer?: string;
};

export function captureLeadAttribution(
  search: string | URLSearchParams,
  currentFormUrl: string,
  documentReferrer?: string,
): LeadAttribution {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const passedLanding = officialLanding(params.get("landing_url") ?? params.get("landingUrl"));
  const browserReferrer = validHttpUrl(documentReferrer);
  const landingUrl = passedLanding ?? officialLanding(browserReferrer) ?? validHttpUrl(currentFormUrl);
  const explicitReferrer = validHttpUrl(params.get("referrer"));
  const utmSource = optionalParam(params, "utm_source");
  return {
    source: optionalParam(params, "source") ?? utmSource ?? (passedLanding ? "ra-training.com" : undefined),
    utmSource,
    utmMedium: optionalParam(params, "utm_medium"),
    utmCampaign: optionalParam(params, "utm_campaign"),
    utmContent: optionalParam(params, "utm_content"),
    utmTerm: optionalParam(params, "utm_term"),
    landingUrl,
    referrer: explicitReferrer ?? browserReferrer,
  };
}
