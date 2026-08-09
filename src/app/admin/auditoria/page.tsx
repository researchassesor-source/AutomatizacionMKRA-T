import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { AuditLogTable } from "./AuditLogTable";

export const dynamic = "force-dynamic";

type AuditFilters = { action?: string; actor?: string; entity?: string; result?: string; from?: string; to?: string };

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditFilters> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (session.role !== "ADMIN") return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar la auditoría." /></main>;

  const createdAt: Prisma.DateTimeFilter | undefined = validDate(filters.from) || validDate(filters.to) ? {
    ...(validDate(filters.from) ? { gte: new Date(`${filters.from}T00:00:00-05:00`) } : {}),
    ...(validDate(filters.to) ? { lte: new Date(`${filters.to}T23:59:59-05:00`) } : {}),
  } : undefined;
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.action ? { action: { contains: filters.action, mode: "insensitive" } } : {}),
    ...(filters.actor ? { actorEmail: { contains: filters.actor, mode: "insensitive" } } : {}),
    ...(filters.entity ? { entityType: filters.entity } : {}),
    ...(filters.result ? { result: filters.result } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
  const success = logs.filter((log) => log.result === "SUCCESS").length;
  const attention = logs.length - success;
  const hasFilters = Boolean(filters.action || filters.actor || filters.entity || filters.result || filters.from || filters.to);

  return <main className="container admin-shell">
    <AdminNav view={view} />
    <AdminPageHeader eyebrow="Control interno" title="Auditoría" description="Historial de acciones, responsables y resultados registrados por el CRM." />
    <section className={`summary-line ${attention > 0 ? "is-attention" : ""}`} aria-label="Resumen de auditoría"><span><strong>{logs.length}</strong> eventos</span><span className="summary-sep">·</span><span><strong>{success}</strong> correctos</span><span className="summary-sep">·</span><span><strong>{attention}</strong> requieren revisión</span></section>
    <form className="phase3-primary-filters"><div className="filter-bar phase3-audit-filter-grid">
      <input name="action" defaultValue={filters.action ?? ""} placeholder="Buscar acción" aria-label="Buscar acción" />
      <input name="actor" defaultValue={filters.actor ?? ""} placeholder="Buscar responsable" aria-label="Buscar responsable" />
      <select name="entity" defaultValue={filters.entity ?? ""} aria-label="Área"><option value="">Todas las áreas</option><option value="AdminUser">Acceso</option><option value="Lead">Contactos</option><option value="Enrollment">Inscripciones</option><option value="Course">Cursos</option><option value="OutboundMessage">Comunicaciones</option><option value="AutomationRule">Automatizaciones</option><option value="SocialPost">Publicaciones</option></select>
      <select name="result" defaultValue={filters.result ?? ""} aria-label="Resultado"><option value="">Todos los resultados</option><option value="SUCCESS">Correcto</option><option value="FAILURE">Requiere revisión</option></select>
      <input name="from" type="date" defaultValue={filters.from ?? ""} aria-label="Desde esta fecha" />
      <input name="to" type="date" defaultValue={filters.to ?? ""} aria-label="Hasta esta fecha" />
      <div className="filter-actions"><button type="submit" className="btn-sm">Filtrar</button>{hasFilters ? <Link className="btn-sm ghost" href="/admin/auditoria">Quitar filtros</Link> : null}</div>
    </div></form>
    <section className="panel phase3-table-panel">
      {logs.length === 0 ? <AdminEmptyState icon="audit" title="No hay eventos con estos filtros" description="Ajusta los criterios o quita los filtros para ver otros registros." /> : <AuditLogTable technical={view === "tecnica"} logs={logs.map((log) => ({ id: log.id, actorEmail: log.actorEmail, action: log.action, entityType: log.entityType, entityId: log.entityId, result: log.result, metadata: log.metadata, createdAt: log.createdAt.toISOString() }))} />}
    </section>
  </main>;
}
