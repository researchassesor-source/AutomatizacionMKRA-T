export const ADMIN_COOKIE = "ra_crm_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export type SessionRole = "ADMIN" | "DIRECCION" | "MARKETING" | "VENTAS" | "LECTURA";

export type AdminSession = {
  userId: string | null;
  email: string;
  name: string;
  role: SessionRole;
  legacy: boolean;
  expiresAt: number;
};

function sessionSecret(): string | null {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit && (process.env.NODE_ENV !== "production" || explicit.length >= 32)) {
    return explicit;
  }
  return process.env.NODE_ENV !== "production" ? process.env.ADMIN_PASSWORD || null : null;
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encode(String.fromCharCode(...new Uint8Array(signature)));
}

export async function createSessionToken(
  data: Omit<AdminSession, "expiresAt">,
): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = encode(
    JSON.stringify({ ...data, expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }),
  );
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(token?: string | null): Promise<AdminSession | null> {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expectedSignature = await sign(payload, secret);
  if (suppliedSignature.length !== expectedSignature.length) return null;
  let mismatch = 0;
  for (let index = 0; index < suppliedSignature.length; index++) {
    mismatch |= suppliedSignature.charCodeAt(index) ^ expectedSignature.charCodeAt(index);
  }
  if (mismatch !== 0) return null;
  try {
    const parsed = JSON.parse(decode(payload)) as AdminSession;
    if (!parsed.expiresAt || parsed.expiresAt <= Date.now()) return null;
    if (!["ADMIN", "DIRECCION", "MARKETING", "VENTAS", "LECTURA"].includes(parsed.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function authIsConfigured(): boolean {
  return Boolean(sessionSecret());
}
