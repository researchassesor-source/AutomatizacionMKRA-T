import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { IntegrationStatusPanel } from "../IntegrationStatusPanel";
import { DispatchButton } from "./DispatchButton";
import { EmailTestPanel } from "./EmailTestPanel";
import { MessageList, type MessageRow } from "./MessageList";
import { TemplateManager } from "./TemplateManager";
import { WhatsAppStatusPanel } from "./WhatsAppStatusPanel";
import { isMessagingSimulation } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

const ESTADOS_VISIBLES = [
  { value: "PROGRAMADO", label: "Programados" },
  { value: "ENVIADO", label: "Enviados" },
  { value: "ENTREGADO", label: "Recibidos" },
  { value: "FALLIDO", label: "Con problema" },
  { value: "SIMULADO", label: "Pruebas" },
] as const;

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!["ADMIN", "DIRECCION", "MARKETING", "VENTAS"].includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar mensajes." /></main>;
  }
  const tecnico = view === "tecnica";

  const where: Prisma.OutboundMessageWhereInput = {
    ...(filters.channel ? { channel: filters.channel as "EMAIL" | "WHATSAPP" } : {}),
    ...(filters.status ? { status: filters.status as Prisma.EnumMessageStatusFilter } : {}),
    ...(filters.lead ? { lead: { fullName: { contains: filters.lead, mode: "insensitive" } } } : {}),
    ...(filters.course ? { enrollment: { courseId: filters.course } } : {}),
    ...(filters.from ? { scheduledAt: { gte: new Date(`${filters.from}T00:00:00-05:00`) } } : {}),
  };

  const [messages, courses, pendingCount, waRulesWithoutTemplate, waQueued, conProblema] = await Promise.all([
    prisma.outboundMessage.findMany({ where, orderBy: { scheduledAt: "desc" }, take: 150, include: { lead: true, enrollment: { include: { course: true } } } }),
    prisma.course.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.outboundMessage.count({ where: { OR: [{ status: "PROGRAMADO", scheduledAt: { lte: new Date() } }, { status: "FALLIDO", attemptCount: { lt: 5 }, nextAttemptAt: { lte: new Date() } }] } }),
    prisma.automationRule.count({ where: { channel: "WHATSAPP", status: { in: ["ACTIVE", "PAUSED"] }, OR: [{ waTemplateName: null }, { waTemplateName: "" }] } }),
    prisma.outboundMessage.count({ where: { channel: "WHATSAPP", status: "PROGRAMADO" } }),
    prisma.outboundMessage.count({ where: { status: { in: ["FALLIDO", "REBOTADO", "OMITIDO"] } } }),
  ]);

  const rows: MessageRow[] = messages.map((message) => ({
    id: message.id,
    leadId: message.leadId,
    channel: message.channel,
    status: message.status,
    toAddress: message.toAddress,
    subject: message.subject,
    body: message.body,
    scheduledAt: message.scheduledAt,
    acceptedAt: message.acceptedAt,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    error: message.error,
    providerName: message.providerName,
    providerMessageId: message.providerMessageId,
    attemptCount: message.attemptCount,
    isSimulation: message.isSimulation,
    leadName: message.lead.fullName,
    courseTitle: message.enrollment?.course.title ?? null,
  }));

  const hayFiltro = Boolean(filters.channel || filters.status || filters.lead || filters.course || filters.from);

  return <main className="container admin-shell">
    <AdminNav view={view} />
    <AdminPageHeader
      eyebrow="Comunicación"
      title="Comunicaciones"
      description="Todo lo que el sistema envía a los contactos: qué salió, a quién y si llegó."
      actions={<DispatchButton simulation={isMessagingSimulation()} pendingCount={pendingCount} />}
    />

    <section className={`summary-line ${conProblema > 0 ? "is-attention" : ""}`}>
      <strong>{messages.length}</strong> mensaje{messages.length === 1 ? "" : "s"} en la vista
      <span className="summary-sep">·</span>
      <strong>{pendingCount}</strong> esperando salir
      {conProblema > 0 ? <>
        <span className="summary-sep">·</span>
        <strong>{conProblema}</strong> con problema
        <span className="summary-actions"><Link className="btn-sm" href="/admin/mensajes?status=FALLIDO">Ver los que fallaron</Link></span>
      </> : null}
    </section>

    <form>
      <div className="filter-bar">
        <input name="lead" aria-label="Buscar por contacto" defaultValue={filters.lead ?? ""} placeholder="Buscar contacto…" />
        <select name="channel" aria-label="Canal" defaultValue={filters.channel ?? ""}>
          <option value="">Correo y WhatsApp</option>
          <option value="EMAIL">Solo correo</option>
          <option value="WHATSAPP">Solo WhatsApp</option>
        </select>
        <select name="status" aria-label="Estado" defaultValue={filters.status ?? ""}>
          <option value="">Todos los estados</option>
          {ESTADOS_VISIBLES.map((estado) => <option key={estado.value} value={estado.value}>{estado.label}</option>)}
        </select>
        <button type="submit" className="btn-sm">Filtrar</button>
        {hayFiltro ? <Link className="btn-sm ghost" href="/admin/mensajes">Quitar filtros</Link> : null}
      </div>
      <details className="disclosure">
        <summary>Más filtros</summary>
        <div className="disclosure-body filter-bar">
          <select name="course" aria-label="Curso" defaultValue={filters.course ?? ""}>
            <option value="">Todos los cursos</option>
            {courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}
          </select>
          <input name="from" type="date" defaultValue={filters.from ?? ""} aria-label="Desde esta fecha" />
          <button type="submit" className="btn-sm">Aplicar</button>
        </div>
      </details>
    </form>

    <section className="panel">
      {rows.length === 0
        ? <AdminEmptyState
            icon="messages"
            title={hayFiltro ? "No hay mensajes con estos filtros" : "Todavía no se ha enviado nada"}
            description={hayFiltro ? "Prueba a quitar algún filtro." : "Cuando alguien se inscriba, su confirmación aparecerá aquí."}
          />
        : <MessageList messages={rows} now={new Date()} />}
    </section>

    {tecnico ? <>
      <IntegrationStatusPanel technical only={["email", "whatsapp", "cron"]} />
      <WhatsAppStatusPanel rulesWithoutTemplate={waRulesWithoutTemplate} queued={waQueued} />
      <EmailTestPanel />
      <TemplateManager />
    </> : null}
  </main>;
}
