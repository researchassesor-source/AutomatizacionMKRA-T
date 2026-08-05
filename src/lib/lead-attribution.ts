const OFFICIAL_HOSTS = new Set(["ra-training.com", "www.ra-training.com"]);

const SAFE_TRACKING = /^[\p{L}\p{N} ._\-:/+]+$/u;
const SAFE_CLICK_ID = /^[A-Za-z0-9._~-]+$/;

const MAX_TRACKING_LENGTH = 120;
const MAX_CLICK_ID_LENGTH = 512;
const MAX_ATTRIBUTION_URL_LENGTH = 500;

function validHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.trim();

  if (
    !normalized
    || normalized.length > MAX_ATTRIBUTION_URL_LENGTH
  ) {
    return undefined;
  }

  try {
    const url = new URL(normalized);

    if (!["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function officialLanding(value: string | null | undefined): string | undefined {
  const parsed = validHttpUrl(value);

  if (!parsed) return undefined;

  return OFFICIAL_HOSTS.has(new URL(parsed).hostname)
    ? parsed
    : undefined;
}

function optionalParam(
  params: URLSearchParams,
  key: string,
  maxLength: number,
  pattern: RegExp,
): string | undefined {
  const value = params.get(key)?.trim();

  if (
    !value
    || value.length > maxLength
    || !pattern.test(value)
  ) {
    return undefined;
  }

  return value;
}

function trackingParam(
  params: URLSearchParams,
  key: string,
): string | undefined {
  return optionalParam(
    params,
    key,
    MAX_TRACKING_LENGTH,
    SAFE_TRACKING,
  );
}

function clickIdParam(
  params: URLSearchParams,
  key: string,
): string | undefined {
  return optionalParam(
    params,
    key,
    MAX_CLICK_ID_LENGTH,
    SAFE_CLICK_ID,
  );
}

export type LeadAttribution = {
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
  landingUrl?: string;
  referrer?: string;
};

export function captureLeadAttribution(
  search: string | URLSearchParams,
  currentFormUrl: string,
  documentReferrer?: string,
): LeadAttribution {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search)
      : search;

  const passedLanding = officialLanding(
    params.get("landing_url") ?? params.get("landingUrl"),
  );

  const browserReferrer = validHttpUrl(documentReferrer);

  const landingUrl =
    passedLanding
    ?? officialLanding(browserReferrer)
    ?? validHttpUrl(currentFormUrl);

  const explicitReferrer = validHttpUrl(params.get("referrer"));
  const utmSource = trackingParam(params, "utm_source");

  return {
    source:
      trackingParam(params, "source")
      ?? utmSource
      ?? (passedLanding ? "ra-training.com" : undefined),
    utmSource,
    utmMedium: trackingParam(params, "utm_medium"),
    utmCampaign: trackingParam(params, "utm_campaign"),
    utmContent: trackingParam(params, "utm_content"),
    utmTerm: trackingParam(params, "utm_term"),
    fbclid: clickIdParam(params, "fbclid"),
    gclid: clickIdParam(params, "gclid"),
    ttclid: clickIdParam(params, "ttclid"),
    landingUrl,
    referrer: explicitReferrer ?? browserReferrer,
  };
}