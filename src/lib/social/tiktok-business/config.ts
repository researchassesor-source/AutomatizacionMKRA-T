import { parseEncryptionKey } from "@/lib/crypto/token-cipher";

export type TikTokBusinessMode = "disabled" | "live";
export type EnvSource = Record<string, string | undefined>;

export const TIKTOK_BUSINESS_SCOPES = ["user.info.basic", "video.list", "video.publish"] as const;

export type TikTokBusinessConfig = {
  mode: TikTokBusinessMode;
  appId: string | null;
  secret: string | null;
  accountRedirectUri: string | null;
  advertiserRedirectUri: string | null;
  stateSecret: string | null;
  encryptionKey: Buffer | null;
  liveFrom: Date | null;
  connectionReason: string | null;
  reason: string | null;
};

function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function validRedirect(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function resolveTikTokBusinessConfig(env: EnvSource = process.env): TikTokBusinessConfig {
  const mode: TikTokBusinessMode = env.TIKTOK_BUSINESS_MODE?.trim().toLowerCase() === "live" ? "live" : "disabled";
  const appId = value(env.TIKTOK_BUSINESS_APP_ID);
  const secret = value(env.TIKTOK_BUSINESS_SECRET);
  const accountRedirectUri = value(env.TIKTOK_BUSINESS_ACCOUNT_REDIRECT_URI);
  const advertiserRedirectUri = value(env.TIKTOK_BUSINESS_ADVERTISER_REDIRECT_URI);
  const stateSecret = value(env.TIKTOK_BUSINESS_OAUTH_STATE_SECRET);
  const liveFromRaw = value(env.TIKTOK_BUSINESS_LIVE_FROM);
  const liveFrom = liveFromRaw && Number.isFinite(Date.parse(liveFromRaw)) ? new Date(liveFromRaw) : null;
  let encryptionKey: Buffer | null = null;
  try {
    encryptionKey = parseEncryptionKey(env.TIKTOK_BUSINESS_TOKEN_ENCRYPTION_KEY);
  } catch {
    encryptionKey = null;
  }

  const base = { mode, appId, secret, accountRedirectUri, advertiserRedirectUri, stateSecret, encryptionKey, liveFrom };
  if (!appId || !secret) {
    const connectionReason = "La aplicación TikTok Business está pendiente de aprobación/configuración.";
    return { ...base, connectionReason, reason: connectionReason };
  }
  if (!validRedirect(accountRedirectUri) || !validRedirect(advertiserRedirectUri)) {
    const connectionReason = "Los callbacks de TikTok Business deben ser URL HTTPS absolutas y sin parámetros.";
    return { ...base, connectionReason, reason: connectionReason };
  }
  if (!stateSecret || stateSecret.length < 32) {
    const connectionReason = "Falta TIKTOK_BUSINESS_OAUTH_STATE_SECRET o tiene menos de 32 caracteres.";
    return { ...base, connectionReason, reason: connectionReason };
  }
  if (!encryptionKey) {
    const connectionReason = "Falta una TIKTOK_BUSINESS_TOKEN_ENCRYPTION_KEY válida de 32 bytes.";
    return { ...base, connectionReason, reason: connectionReason };
  }
  if (mode === "disabled") return { ...base, connectionReason: null, reason: "La publicación de TikTok Business está desactivada." };
  if (!liveFrom) return { ...base, connectionReason: null, reason: "Falta TIKTOK_BUSINESS_LIVE_FROM con fecha ISO 8601 válida." };
  return { ...base, connectionReason: null, reason: null };
}

export function isTikTokBusinessOperational(config = resolveTikTokBusinessConfig()): boolean {
  return config.reason === null;
}

export function isWithinTikTokBusinessWindow(date: Date, config = resolveTikTokBusinessConfig()): boolean {
  return isTikTokBusinessOperational(config) && Boolean(config.liveFrom && date >= config.liveFrom);
}

export function hasRequiredTikTokBusinessScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  return TIKTOK_BUSINESS_SCOPES.every((scope) => granted.has(scope));
}

export function isApprovedTikTokBusinessMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && host.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export function describeTikTokBusinessConfig(config = resolveTikTokBusinessConfig()) {
  return {
    mode: config.mode,
    appIdConfigured: Boolean(config.appId),
    secretConfigured: Boolean(config.secret),
    accountRedirectUri: config.accountRedirectUri,
    advertiserRedirectUri: config.advertiserRedirectUri,
    stateSecretConfigured: Boolean(config.stateSecret),
    encryptionKeyConfigured: Boolean(config.encryptionKey),
    liveFrom: config.liveFrom?.toISOString() ?? null,
    scopes: [...TIKTOK_BUSINESS_SCOPES],
    connectionReason: config.connectionReason,
    reason: config.reason,
  };
}
