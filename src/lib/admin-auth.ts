// Compatibilidad temporal con instalaciones locales que todavía usan una
// contraseña compartida. Las sesiones nuevas viven en lib/auth/session.
import { timingSafeEqual } from "node:crypto";

export { ADMIN_COOKIE } from "@/lib/auth/session";

export function isLegacyAdminEnabled(): boolean {
  const configured = process.env.ADMIN_LEGACY_LOGIN_ENABLED?.trim().toLowerCase();
  if (configured && !["1", "true", "yes", "on", "si", "sí"].includes(configured)) {
    return false;
  }
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function checkLegacyPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function canUseLegacyAdminLogin(email: string, candidate: string): boolean {
  return email.trim() === "" && isLegacyAdminEnabled() && checkLegacyPassword(candidate);
}
