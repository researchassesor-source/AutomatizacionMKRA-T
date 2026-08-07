import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { presentAdminValue } from "../adminPresentation";
import { FollowUpActions } from "./FollowUpActions";
import { ecuadorDayBounds } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "pending" } = await searchParams;
  const session = await currentAdminSession();
  const vista = await resolveViewMode(session.role);
  if (!session || !["ADMIN", "VENTAS"].includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={vista} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar seguimientos." /></main>;
  }
  const now = new Date();
  const { start: startToday, end: endToday } = ecuadorDayBounds(now);
  const where: Prisma.FollowUpWhereInput = view === "today"
    ? { status: "PENDIENTE", dueAt: { gte: startToday, lte: endToday } }
    : view === "overdue"
      ? { status: { in: ["PENDIENTE", "VENCIDO"] }, dueAt: { lt: now } }
      : view === "upcoming"
        ? { status: "PENDIENTE", dueAt: { gt: endToday } }
        : view === "completed"
          ? { status: "COMPLETADO" }
          : { status: { in: ["PENDIENTE", "VENCIDO"] } };
  const followUps = await prisma.followUp.findMany({ where, include: { lead: true, assignedTo: true }, orderBy: { dueAt: "asc" }, take: 200 });
  return (
    <main className="container admin-shell">
      <AdminNav view={vista} />
      <AdminPageHeader eyebrow="Agenda comercial" title="Seguimientos" description="Prioriza llamadas, mensajes, reuniones y recordatorios del equipo comercial." />
      <div className="toolbar segmented-tabs">{[["pending","Pendientes"],["today","De hoy"],["overdue","Vencidos"],["upcoming","Próximos"],["completed","Completados"]].map(([key,label]) => <Link key={key} className={`btn-sm ${view === key ? "" : "ghost"}`} href={`/admin/seguimientos?view=${key}`}>{label}</Link>)}</div>
      <div className="panel">
        {followUps.length === 0 ? <AdminEmptyState icon="calendar" title="No hay seguimientos en esta vista" description="Cambia la vista para consultar otros periodos o estados." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contacto</th><th>Responsable</th><th>Estado</th><th>Notas</th><th>Acciones</th></tr></thead><tbody>{followUps.map((item) => {
          const effectiveStatus = item.status === "PENDIENTE" && item.dueAt < now ? "VENCIDO" : item.status;
          return <tr key={item.id}><td>{new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" }).format(item.dueAt)}</td><td>{presentAdminValue(item.type)}</td><td><Link href={`/admin/leads/${item.leadId}`}>{item.lead.fullName}</Link></td><td>{item.assignedTo?.name ?? "Sin asignar"}</td><td><span className={`pill ${effectiveStatus === "VENCIDO" ? "err" : effectiveStatus === "COMPLETADO" ? "ok" : "warn"}`}>{presentAdminValue(effectiveStatus)}</span></td><td>{item.notes ?? "—"}</td><td><FollowUpActions id={item.id} status={effectiveStatus} /></td></tr>;
        })}</tbody></table></div>}
      </div>
    </main>
  );
}
