import { createHmac, randomBytes } from "node:crypto";
import { safeEquals } from "@/lib/crypto/token-cipher";
import { businessRequest, requireBusinessCredentials } from "./client";
import { TIKTOK_BUSINESS_SCOPES, type TikTokBusinessConfig } from "./config";

export const TIKTOK_BUSINESS_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const STATE_COOKIE = "tiktok_business_oauth_state";
export const STATE_TTL_SECONDS = 600;

type OAuthState = { nonce: string; adminId: string; issuedAt: number; expiresAt: number };

export function oauthIdentity(session: { userId: string | null; email: string }): string {
  return session.userId ?? `legacy:${session.email}`;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createOAuthState(adminId: string, secret: string, now = Date.now()) {
  const expiresAt = now + STATE_TTL_SECONDS * 1000;
  const payload = Buffer.from(JSON.stringify({
    nonce: randomBytes(16).toString("base64url"), adminId, issuedAt: now, expiresAt,
  })).toString("base64url");
  return { state: `${payload}.${sign(payload, secret)}`, expiresAt };
}

export function verifyOAuthState(
  received: string | null | undefined,
  cookie: string | null | undefined,
  secret: string,
  adminId: string,
  now = Date.now(),
): { ok: true; state: OAuthState } | { ok: false; reason: string } {
  if (!received || !cookie) return { ok: false, reason: "MALFORMED" };
  if (!safeEquals(received, cookie)) return { ok: false, reason: "MISMATCHED_COOKIE" };
  const [payload, signature] = received.split(".");
  if (!payload || !signature) return { ok: false, reason: "MALFORMED" };
  if (!safeEquals(signature, sign(payload, secret))) return { ok: false, reason: "BAD_SIGNATURE" };
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (state.adminId !== adminId) return { ok: false, reason: "WRONG_ADMIN" };
    if (!Number.isFinite(state.expiresAt) || state.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
    return { ok: true, state };
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
}

export function buildAuthorizeUrl(config: TikTokBusinessConfig, state: string, forceConsent = false): string {
  if (!config.appId || !config.accountRedirectUri) throw new Error("TIKTOK_BUSINESS_NOT_CONFIGURED");
  const url = new URL(TIKTOK_BUSINESS_AUTHORIZE_URL);
  url.searchParams.set("client_key", config.appId);
  url.searchParams.set("scope", TIKTOK_BUSINESS_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.accountRedirectUri);
  url.searchParams.set("state", state);
  if (forceConsent) url.searchParams.set("disable_auto_auth", "1");
  return url.toString();
}

export type BusinessTokens = {
  accessToken: string;
  refreshToken: string;
  businessId: string;
  scopes: string[];
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};

type TokenData = {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  scope?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
};

function parseTokens(data: TokenData, now: number): BusinessTokens | null {
  if (!data.access_token || !data.refresh_token || !data.open_id) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    businessId: data.open_id,
    scopes: (data.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean),
    accessTokenExpiresAt: new Date(now + (data.expires_in ?? 86_400) * 1000),
    refreshTokenExpiresAt: new Date(now + (data.refresh_token_expires_in ?? 31_536_000) * 1000),
  };
}

async function tokenRequest(
  config: TikTokBusinessConfig,
  body: Record<string, string>,
  fetcher: typeof fetch,
  now: number,
) {
  const credentials = requireBusinessCredentials(config);
  if (!credentials) return { ok: false as const, errorCode: "NOT_CONFIGURED", error: "TikTok Business no está configurado." };
  const response = await businessRequest<TokenData>({
    path: body.grant_type === "refresh_token" ? "/tt_user/oauth2/refresh_token/" : "/tt_user/oauth2/token/",
    method: "POST",
    body: { client_id: credentials.appId, client_secret: credentials.secret, ...body },
    fetcher,
  });
  if (!response.ok) return response;
  const tokens = parseTokens(response.data, now);
  return tokens
    ? { ok: true as const, tokens }
    : { ok: false as const, errorCode: "INCOMPLETE_TOKEN_RESPONSE", error: "TikTok Business respondió sin tokens completos." };
}

export function exchangeCodeForTokens(config: TikTokBusinessConfig, authCode: string, fetcher: typeof fetch = fetch, now = Date.now()) {
  return tokenRequest(config, {
    grant_type: "authorization_code",
    auth_code: authCode,
    redirect_uri: config.accountRedirectUri ?? "",
  }, fetcher, now);
}

export function refreshTokens(config: TikTokBusinessConfig, refreshToken: string, fetcher: typeof fetch = fetch, now = Date.now()) {
  return tokenRequest(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetcher, now);
}

export async function revokeToken(config: TikTokBusinessConfig, accessToken: string, fetcher: typeof fetch = fetch) {
  const credentials = requireBusinessCredentials(config);
  if (!credentials) return { ok: false };
  const response = await businessRequest<Record<string, never>>({
    path: "/tt_user/oauth2/revoke/",
    method: "POST",
    body: { client_id: credentials.appId, client_secret: credentials.secret, access_token: accessToken },
    fetcher,
  });
  return { ok: response.ok };
}

export function needsRefresh(expiresAt: Date | null, now = new Date(), marginSeconds = 300): boolean {
  return !expiresAt || expiresAt.getTime() - now.getTime() <= marginSeconds * 1000;
}
