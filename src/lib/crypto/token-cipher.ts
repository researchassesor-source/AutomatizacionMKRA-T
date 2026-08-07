import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado autenticado para los tokens OAuth guardados en la base.
 *
 * AES-256-GCM: confidencialidad + integridad. Sin el tag de autenticación, un
 * atacante con acceso de escritura a la base podría alterar un token cifrado
 * sin que lo notáramos; GCM lo detecta al descifrar.
 *
 * Formato: `v1.<iv>.<tag>.<ciphertext>` en base64url. El prefijo de versión
 * permite rotar el algoritmo más adelante sin romper lo ya almacenado.
 */
const VERSION = "v1";
const IV_BYTES = 12; // Recomendado para GCM.
const KEY_BYTES = 32; // AES-256.

export class TokenCipherError extends Error {}

/**
 * La clave se acepta en base64 o hex y debe medir exactamente 32 bytes.
 * Generar con: openssl rand -base64 32
 */
export function parseEncryptionKey(raw: string | undefined): Buffer {
  const value = raw?.trim();
  if (!value) throw new TokenCipherError("Falta TIKTOK_TOKEN_ENCRYPTION_KEY.");
  const candidates = [
    () => Buffer.from(value, "base64"),
    () => (/^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.alloc(0)),
  ];
  for (const decode of candidates) {
    const key = decode();
    if (key.length === KEY_BYTES) return key;
  }
  throw new TokenCipherError("TIKTOK_TOKEN_ENCRYPTION_KEY debe contener 32 bytes (base64 o hex).");
}

export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new TokenCipherError("Clave de cifrado con longitud incorrecta.");
  // Un IV único por mensaje es obligatorio en GCM: repetirlo con la misma clave
  // rompe por completo la garantía del cifrado.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptToken(payload: string, key: Buffer): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new TokenCipherError("Formato de token cifrado no reconocido.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // No se distingue "clave incorrecta" de "dato manipulado": ambos son fallo
    // de autenticación y no conviene dar pistas.
    throw new TokenCipherError("No se pudo descifrar el token almacenado.");
  }
}

/** Versión del formato, para poder migrar tokens antiguos si se rota. */
export function tokenCipherVersion(payload: string): string | null {
  const version = payload.split(".")[0];
  return version === VERSION ? version : null;
}

/** Comparación en tiempo constante para valores como `state` o firmas. */
export function safeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
