import { CRM_PUBLIC_URL, OFFICIAL_SITE_URL } from "@/data/course-capture-mapping";

function originFrom(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function publicLeadAllowedOrigins(requestUrl: string, env: NodeJS.ProcessEnv = process.env) {
  const origins = new Set<string>([
    new URL(requestUrl).origin,
    new URL(CRM_PUBLIC_URL).origin,
    new URL(OFFICIAL_SITE_URL).origin,
    "https://www.ra-training.com",
  ]);
  for (const candidate of [env.APP_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const origin = originFrom(candidate);
    if (origin) origins.add(origin);
  }
  if (env.NODE_ENV !== "production" || env.VERCEL_ENV === "development") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}

export function isAllowedPublicLeadOrigin(
  origin: string | null,
  requestUrl: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!origin) return true;
  const normalized = originFrom(origin);
  if (!normalized) return false;
  if ((env.NODE_ENV !== "production" || env.VERCEL_ENV === "development")
    && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(normalized)) {
    return true;
  }
  return publicLeadAllowedOrigins(requestUrl, env).has(normalized);
}

export function publicLeadCorsHeaders(origin: string | null, requestUrl: string) {
  const headers = new Headers({
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
    "Access-Control-Max-Age": "600",
  });
  const normalized = originFrom(origin ?? undefined);
  if (normalized && isAllowedPublicLeadOrigin(normalized, requestUrl)) {
    headers.set("Access-Control-Allow-Origin", normalized);
  }
  return headers;
}
