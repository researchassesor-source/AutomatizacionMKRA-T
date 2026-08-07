import type { SessionRole, AdminSession } from "./session";
import { ADMIN_COOKIE, verifySessionToken } from "./session";
import { resolveActiveAdminSession } from "./active-session";

export const ROLE_PERMISSIONS: Record<SessionRole, readonly string[]> = {
  ADMIN: ["*"],
  // Direccion hace lo mismo que ADMIN salvo la sala de maquinas: diagnostico,
  // integraciones, auditoria y borrados irreversibles.
  DIRECCION: ["courses", "campaigns", "social", "templates", "leads", "notes", "followups", "sales", "messages", "users", "finance"],
  MARKETING: ["courses", "campaigns", "social", "templates", "leads:read", "messages"],
  VENTAS: ["leads", "notes", "followups", "sales", "messages", "courses:read", "finance:read"],
  LECTURA: ["read"],
};

export function removesActiveAdministrator(
  current: { role: SessionRole; isActive: boolean },
  changes: { role?: SessionRole; isActive?: boolean },
): boolean {
  return current.role === "ADMIN"
    && current.isActive
    && ((changes.role !== undefined && changes.role !== "ADMIN") || changes.isActive === false);
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function sessionFromRequest(request: Request): Promise<AdminSession | null> {
  const session = await verifySessionToken(cookieValue(request, ADMIN_COOKIE));
  return resolveActiveAdminSession(session);
}

export function isSameOriginAdminRequest(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const expectedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
}

export async function requireRole(
  request: Request,
  allowed: readonly SessionRole[],
): Promise<{ session: AdminSession | null; error: Response | null }> {
  const session = await sessionFromRequest(request);
  if (!session) {
    return {
      session: null,
      error: Response.json({ error: "No autorizado." }, { status: 401 }),
    };
  }
  if (!isSameOriginAdminRequest(request)) {
    return {
      session,
      error: Response.json({ error: "Origen de solicitud no permitido." }, { status: 403 }),
    };
  }
  if (!allowed.includes(session.role)) {
    return {
      session,
      error: Response.json({ error: "No tienes permisos para esta acción." }, { status: 403 }),
    };
  }
  return { session, error: null };
}
