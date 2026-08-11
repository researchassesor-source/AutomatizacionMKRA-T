import type { SessionRole } from "@/lib/auth/session";

/**
 * Perfiles visibles autorizados: Técnico y Dirección.
 *
 * `ADMIN` es el valor histórico persistido para el perfil que la interfaz
 * presenta como Técnico. No se crea un rol nuevo ni se amplía el permiso a
 * los antiguos perfiles comerciales.
 */
export const FINANCE_HANDOFF_ROLES: readonly SessionRole[] = ["ADMIN", "DIRECCION"];

export function canHandoffToFinance(role: SessionRole): boolean {
  return FINANCE_HANDOFF_ROLES.includes(role);
}
