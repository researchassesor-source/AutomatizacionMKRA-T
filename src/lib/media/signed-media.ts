import { createHmac } from "node:crypto";
import { safeEquals } from "@/lib/crypto/token-cipher";

/**
 * URLs firmadas para que TikTok descargue un vídeo con PULL_FROM_URL.
 *
 * TikTok descarga el archivo desde sus propios servidores, sin cookies ni
 * sesión. Servirlo requiere una URL pública, y una URL pública sin más sería
 * enumerable: cualquiera podría recorrer identificadores y descargar material
 * ajeno. Por eso cada enlace lleva firma HMAC y caducidad.
 *
 * La firma cubre el identificador y la expiración juntos: firmar solo el id
 * permitiría reutilizar la firma con otra caducidad.
 */
export type SignedMediaToken = { postId: string; expiresAt: number };

export type SignedMediaVerification =
  | { ok: true; token: SignedMediaToken }
  | { ok: false; reason: "MALFORMED" | "BAD_SIGNATURE" | "EXPIRED" };

function sign(postId: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`${postId}.${expiresAt}`).digest("base64url");
}

/**
 * TikTok puede tardar en descargar: la caducidad debe cubrir el proceso
 * completo, pero no ser eterna.
 */
export const DEFAULT_MEDIA_TTL_SECONDS = 3600;

export function createSignedMediaToken(
  postId: string,
  secret: string,
  ttlSeconds = DEFAULT_MEDIA_TTL_SECONDS,
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  return `${expiresAt}.${sign(postId, expiresAt, secret)}`;
}

export function verifySignedMediaToken(
  postId: string,
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): SignedMediaVerification {
  if (!token) return { ok: false, reason: "MALFORMED" };
  const [rawExpires, signature] = token.split(".");
  const expiresAt = Number.parseInt(rawExpires ?? "", 10);
  if (!signature || !Number.isFinite(expiresAt)) return { ok: false, reason: "MALFORMED" };
  if (!safeEquals(signature, sign(postId, expiresAt, secret))) return { ok: false, reason: "BAD_SIGNATURE" };
  if (expiresAt * 1000 <= now) return { ok: false, reason: "EXPIRED" };
  return { ok: true, token: { postId, expiresAt } };
}

/**
 * Solo se sirven archivos del almacenamiento propio.
 *
 * Sin esta lista blanca el endpoint sería un open proxy: bastaría guardar una
 * URL interna en `mediaUrl` para que el servidor la descargara y la expusiera
 * (SSRF).
 */
const ALLOWED_MEDIA_HOSTS = [/\.public\.blob\.vercel-storage\.com$/i, /^blob\.vercel-storage\.com$/i];

export function isAllowedMediaSource(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return ALLOWED_MEDIA_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch {
    return false;
  }
}

/** MIME derivado de la extensión: no se confía en el que declare el origen. */
export function mediaContentType(url: string): string | null {
  const types: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v" };
  const extension = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  return types[extension] ?? null;
}

export function buildSignedMediaUrl(origin: string, postId: string, secret: string, ttlSeconds?: number): string {
  const url = new URL(`/api/media/tiktok/${encodeURIComponent(postId)}`, origin);
  url.searchParams.set("token", createSignedMediaToken(postId, secret, ttlSeconds));
  return url.toString();
}
