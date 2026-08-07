import { parseEncryptionKey } from "@/lib/crypto/token-cipher";

/**
 * Configuración de TikTok, deliberadamente independiente de SOCIAL_MODE.
 *
 * SOCIAL_MODE gobierna Facebook e Instagram, que ya están validados. Si TikTok
 * colgara de esa misma variable, probar TikTok obligaría a poner Meta en `live`
 * y una prueba de una red podría publicar contenido real en otra. Por eso
 * TikTok tiene su propio interruptor.
 */
export type TikTokMode = "disabled" | "sandbox" | "live";

export type TikTokConfig = {
  mode: TikTokMode;
  clientKey: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
  stateSecret: string | null;
  encryptionKey: Buffer | null;
  /** Motivo legible cuando la integración no puede operar. */
  reason: string | null;
};

export type EnvSource = Record<string, string | undefined>;

/** Scopes realmente implementados. No se solicita nada "por si acaso". */
export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"] as const;

/** Sin este scope no hay integración posible. */
export const TIKTOK_REQUIRED_SCOPE = "user.info.basic";

function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function parseMode(raw: string | undefined): TikTokMode {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "sandbox" || normalized === "live" ? normalized : "disabled";
}

/**
 * El redirect_uri debe ser absoluto, HTTPS, estático y sin query ni fragment:
 * es exactamente lo que exige TikTok y lo que debe coincidir carácter a carácter
 * con lo registrado en el portal.
 */
export function isValidRedirectUri(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.search && !url.hash && url.pathname.length > 1;
  } catch {
    return false;
  }
}

export function resolveTikTokConfig(env: EnvSource = process.env): TikTokConfig {
  const mode = parseMode(env.TIKTOK_MODE);
  const clientKey = value(env.TIKTOK_CLIENT_KEY);
  const clientSecret = value(env.TIKTOK_CLIENT_SECRET);
  const redirectUri = value(env.TIKTOK_REDIRECT_URI);
  const stateSecret = value(env.TIKTOK_OAUTH_STATE_SECRET);

  let encryptionKey: Buffer | null = null;
  let keyError: string | null = null;
  try {
    encryptionKey = parseEncryptionKey(env.TIKTOK_TOKEN_ENCRYPTION_KEY);
  } catch (error) {
    keyError = error instanceof Error ? error.message : "Clave de cifrado no válida.";
  }

  const base = { mode, clientKey, clientSecret, redirectUri, stateSecret, encryptionKey };
  if (mode === "disabled") {
    return { ...base, reason: "La integración de TikTok está desactivada (TIKTOK_MODE=disabled)." };
  }
  if (!clientKey || !clientSecret) {
    return { ...base, reason: "Faltan TIKTOK_CLIENT_KEY o TIKTOK_CLIENT_SECRET." };
  }
  if (!redirectUri) return { ...base, reason: "Falta TIKTOK_REDIRECT_URI." };
  if (!isValidRedirectUri(redirectUri)) {
    return { ...base, reason: "TIKTOK_REDIRECT_URI debe ser una URL https absoluta, sin query ni fragmento." };
  }
  if (!stateSecret || stateSecret.length < 32) {
    return { ...base, reason: "Falta TIKTOK_OAUTH_STATE_SECRET o es demasiado corto (mínimo 32 caracteres)." };
  }
  if (!encryptionKey) return { ...base, reason: keyError ?? "Falta TIKTOK_TOKEN_ENCRYPTION_KEY." };
  return { ...base, reason: null };
}

export function isTikTokOperational(config: TikTokConfig = resolveTikTokConfig()): boolean {
  return config.reason === null;
}

/**
 * Mientras el cliente no esté auditado, TikTok solo admite SELF_ONLY y exige
 * que la cuenta esté en privado. Publicar en cualquier otro nivel sería una
 * llamada condenada a fallar con `unaudited_client_can_only_post_to_private_accounts`.
 */
export function allowedPrivacyLevels(config: TikTokConfig = resolveTikTokConfig()): string[] {
  return config.mode === "live"
    ? ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]
    : ["SELF_ONLY"];
}

/** Resumen para la interfaz. Nunca incluye clave, secreto ni material criptográfico. */
export function describeTikTokConfig(config: TikTokConfig = resolveTikTokConfig()) {
  return {
    mode: config.mode,
    clientKeyConfigured: Boolean(config.clientKey),
    clientSecretConfigured: Boolean(config.clientSecret),
    redirectUri: config.redirectUri,
    stateSecretConfigured: Boolean(config.stateSecret),
    encryptionKeyConfigured: Boolean(config.encryptionKey),
    scopes: [...TIKTOK_SCOPES],
    allowedPrivacyLevels: allowedPrivacyLevels(config),
    reason: config.reason,
  };
}
