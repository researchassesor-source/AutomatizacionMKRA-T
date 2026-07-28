import type { SessionRole, AdminSession } from "./session";
import { ADMIN_COOKIE, verifySessionToken } from "./session";
import { resolveActiveAdminSession } from "./active-session";

export const ROLE_PERMISSIONS: Record<SessionRole, readonly string[]> = {
  ADMIN: ["*"],
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
  if (!allowed.includes(session.role)) {
    return {
      session,
      error: Response.json({ error: "No tienes permisos para esta acción." }, { status: 403 }),
    };
  }
  return { session, error: null };
}
