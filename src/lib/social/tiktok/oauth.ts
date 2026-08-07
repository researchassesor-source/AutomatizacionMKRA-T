import { createHmac, randomBytes } from "node:crypto";
import { safeEquals } from "@/lib/crypto/token-cipher";
import { TIKTOK_SCOPES, type TikTokConfig } from "./config";

/**
 * Login Kit v2. Endpoints oficiales vigentes:
 *   autorización  https://www.tiktok.com/v2/auth/authorize/
 *   token/refresh https://open.tiktokapis.com/v2/oauth/token/
 *   revocación    https://open.tiktokapis.com/v2/oauth/revoke/
 */
export const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TIKTOK_REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";

export const STATE_COOKIE = "tiktok_oauth_state";
export const STATE_TTL_SECONDS = 600;

/**
 * El `state` va firmado con HMAC y lleva dentro el administrador que inició el
 * flujo y su caducidad. Así el callback puede comprobar tres cosas sin
 * almacenar nada: que el valor lo emitimos nosotros, que no ha caducado y que
 * pertenece a quien está usando la sesión.
 */
export type OAuthState = {
  nonce: string;
  adminId: string;
  issuedAt: number;
  expiresAt: number;
};

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createOAuthState(adminId: string, secret: string, now = Date.now()): { state: string; expiresAt: number } {
  const expiresAt = now + STATE_TTL_SECONDS * 1000;
  const payload = Buffer.from(
    JSON.stringify({ nonce: randomBytes(16).toString("base64url"), adminId, issuedAt: now, expiresAt }),
  ).toString("base64url");
  return { state: `${payload}.${sign(payload, secret)}`, expiresAt };
}

export type StateVerification =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" | "MISMATCHED_COOKIE" | "WRONG_ADMIN" };

/**
 * Se exige además que el `state` recibido coincida con el de la cookie: la firma
 * sola no impediría reutilizar un `state` capturado en otro navegador.
 */
export function verifyOAuthState(
  received: string | null | undefined,
  cookieValue: string | null | undefined,
  secret: string,
  adminId: string,
  now = Date.now(),
): StateVerification {
  if (!received || !cookieValue) return { ok: false, reason: "MALFORMED" };
  if (!safeEquals(received, cookieValue)) return { ok: false, reason: "MISMATCHED_COOKIE" };

  const [payload, signature] = received.split(".");
  if (!payload || !signature) return { ok: false, reason: "MALFORMED" };
  if (!safeEquals(signature, sign(payload, secret))) return { ok: false, reason: "BAD_SIGNATURE" };

  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }
  if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) return { ok: false, reason: "EXPIRED" };
  if (parsed.adminId !== adminId) return { ok: false, reason: "WRONG_ADMIN" };
  return { ok: true, state: parsed };
}

/**
 * `disable_auto_auth=1` fuerza a TikTok a mostrar la pantalla de consentimiento
 * aunque el usuario ya haya autorizado antes. Es lo que hace visible el paso de
 * autorización al reconectar y en la demo de revisión.
 */
export function buildAuthorizeUrl(
  config: TikTokConfig,
  state: string,
  options: { forceConsent?: boolean } = {},
): string {
  if (!config.clientKey || !config.redirectUri) throw new Error("TIKTOK_NOT_CONFIGURED");
  const url = new URL(TIKTOK_AUTHORIZE_URL);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("scope", TIKTOK_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  if (options.forceConsent) url.searchParams.set("disable_auto_auth", "1");
  return url.toString();
}

export type TikTokTokens = {
  accessToken: string;
  refreshToken: string;
  openId: string;
  scopes: string[];
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};

export type TokenExchangeResult =
  | { ok: true; tokens: TikTokTokens }
  | { ok: false; errorCode: string; error: string };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  scope?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  error?: string;
  error_description?: string;
};

function toTokens(data: TokenResponse, now: number): TikTokTokens | null {
  if (!data.access_token || !data.refresh_token || !data.open_id) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    openId: data.open_id,
    scopes: (data.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean),
    accessTokenExpiresAt: new Date(now + (data.expires_in ?? 86_400) * 1000),
    refreshTokenExpiresAt: new Date(now + (data.refresh_expires_in ?? 31_536_000) * 1000),
  };
}

async function requestToken(
  config: TikTokConfig,
  params: Record<string, string>,
  fetcher: typeof fetch,
  now: number,
): Promise<TokenExchangeResult> {
  if (!config.clientKey || !config.clientSecret) {
    return { ok: false, errorCode: "TIKTOK_NOT_CONFIGURED", error: "Faltan las credenciales de la aplicación de TikTok." };
  }
  try {
    const response = await fetcher(TIKTOK_TOKEN_URL, {
      method: "POST",
      // TikTok exige form-urlencoded en el endpoint de token; con JSON responde
      // invalid_request.
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: config.clientKey,
        client_secret: config.clientSecret,
        ...params,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as TokenResponse;
    if (data.error) {
      return { ok: false, errorCode: data.error.slice(0, 120), error: describeTokenError(data.error) };
    }
    const tokens = toTokens(data, now);
    if (!tokens) {
      return { ok: false, errorCode: "INCOMPLETE_TOKEN_RESPONSE", error: "TikTok respondió sin los datos necesarios para completar la conexión." };
    }
    return { ok: true, tokens };
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR", error: "No se pudo contactar con TikTok." };
  }
}

export function exchangeCodeForTokens(
  config: TikTokConfig,
  code: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<TokenExchangeResult> {
  // El redirect_uri debe repetirse idéntico al de la autorización.
  return requestToken(config, {
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri ?? "",
  }, fetcher, now);
}

export function refreshTokens(
  config: TikTokConfig,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<TokenExchangeResult> {
  return requestToken(config, { grant_type: "refresh_token", refresh_token: refreshToken }, fetcher, now);
}

export async function revokeToken(
  config: TikTokConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!config.clientKey || !config.clientSecret) return { ok: false, error: "Credenciales no configuradas." };
  try {
    const response = await fetcher(TIKTOK_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, token: accessToken }),
    });
    return { ok: response.ok };
  } catch {
    return { ok: false, error: "No se pudo contactar con TikTok para revocar el acceso." };
  }
}

/** Traduce los errores de OAuth a algo accionable, sin filtrar detalle técnico. */
export function describeTokenError(code: string): string {
  const messages: Record<string, string> = {
    invalid_grant: "El código de autorización caducó o ya se usó. Vuelve a conectar la cuenta.",
    invalid_request: "TikTok rechazó la solicitud de token. Revisa que el redirect URI coincida exactamente con el registrado.",
    invalid_client: "La clave o el secreto de la aplicación de TikTok no son válidos.",
    access_denied: "La persona usuaria no autorizó el acceso.",
    scope_not_authorized: "No se concedieron los permisos necesarios.",
  };
  return messages[code] ?? "TikTok rechazó la solicitud de autenticación.";
}

/** Un token se renueva antes de caducar para no fallar a mitad de una publicación. */
export function needsRefresh(expiresAt: Date | null, now = new Date(), marginSeconds = 300): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= marginSeconds * 1000;
}
