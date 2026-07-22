// Autenticacion simple del panel de administracion.
// El acceso se habilita definiendo ADMIN_PASSWORD en el entorno. Si no esta
// definida, el panel queda deshabilitado (seguro por defecto).
//
// La cookie de sesion guarda un hash del password (no el password en claro).
// Funciona tanto en el runtime de Node como en el edge (middleware): usa solo
// Web Crypto y evita Buffer.

export const ADMIN_COOKIE = "mkra_admin";

export function isAdminEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Token de sesion derivado del password. null si el panel esta deshabilitado. */
export async function sessionToken(): Promise<string | null> {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return null;
  const data = new TextEncoder().encode(`mkra:v1:${pw}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export function checkPassword(candidate: string): boolean {
  const pw = process.env.ADMIN_PASSWORD;
  return Boolean(pw) && candidate === pw;
}
