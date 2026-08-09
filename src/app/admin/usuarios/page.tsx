import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { GESTION } from "@/lib/auth/roles";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { UserManager } from "./UserManager";
import { canRecommendLegacyDisable, legacyConfigurationState } from "@/lib/legacy-auth-assessment";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!GESTION.includes(session.role)) return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para administrar usuarios." /></main>;
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60_000);
  const [users, recentLegacyLogins] = await Promise.all([
    prisma.adminUser.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.auditLog.count({ where: { action: "AUTH_LOGIN_LEGACY", createdAt: { gte: ninetyDaysAgo } } }),
  ]);
  const legacyState = legacyConfigurationState();
  const activeAdmins = users.filter((user) => user.isActive && user.role === "ADMIN").length;
  const recommendDisable = canRecommendLegacyDisable({ state: legacyState, activeAdmins, recentLegacyLogins });
  return <main className="container admin-shell"><AdminNav view={view} /><AdminPageHeader eyebrow="Acceso" title="Usuarios" description="Quién puede entrar al panel y con qué perfil." />
    {view === "tecnica" ? <details className="panel access-diagnostic"><summary><span><strong>Diagnóstico de acceso</strong><small>{legacyState === "DISABLED" || legacyState === "NOT_CONFIGURED" ? "✓ Sin problemas detectados" : "Compatibilidad activa"}</small></span><span aria-hidden="true">Ver diagnóstico</span></summary><dl className="detail-list"><dt>Configuración</dt><dd>{legacyState === "DISABLED" ? "Desactivada explícitamente" : legacyState === "EXPLICITLY_ENABLED" ? "Activada explícitamente" : legacyState === "IMPLICITLY_ENABLED" ? "Activada implícitamente por compatibilidad" : "Sin contraseña heredada configurada"}</dd><dt>Perfiles técnicos activos</dt><dd>{activeAdmins}</dd><dt>Ingresos heredados en 90 días</dt><dd>{recentLegacyLogins}</dd><dt>Recomendación</dt><dd>{recommendDisable ? "Preparado para solicitar autorización de desactivación." : "Mantener temporalmente y completar la migración de usuarios."}</dd></dl><p className="muted">Esta comprobación no muestra contraseñas ni valores de variables y no cambia el método de acceso.</p></details> : null}
    <UserManager referenceTime={new Date().toISOString()} users={users.map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, lastLoginAt: user.lastLoginAt?.toISOString() ?? null, createdAt: user.createdAt.toISOString() }))} />
  </main>;
}
