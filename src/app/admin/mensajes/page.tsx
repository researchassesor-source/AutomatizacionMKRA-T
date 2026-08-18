import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { isMessagingSimulation } from "@/lib/nurture/engine";
import { ESTADOS_VISIBLES, esEstadoVisible, filtroDe } from "@/lib/message-states";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { WhatsAppInbox } from "./inbox/WhatsAppInbox";
import { AdminPageHeader } from "../AdminPageHeader";
import { ChannelModeBanner } from "../ChannelModeBanner";
import { HealthStrip } from "../HealthStrip";
import { IntegrationStatusPanel } from "../IntegrationStatusPanel";
import { DispatchButton } from "./DispatchButton";
import { EmailTestPanel } from "./EmailTestPanel";
import { MessageList, type MessageRow } from "./MessageList";
import { TemplateManager } from "./TemplateManager";
import { WhatsAppStatusPanel } from "./WhatsAppStatusPanel";
import { WhatsAppTemplateAudit } from "./WhatsAppTemplateAudit";
import { WhatsAppTestPanel } from "./WhatsAppTestPanel";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!["ADMIN", "DIRECCION", "MARKETING", "VENTAS"].includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar mensajes." /></main>;
  }
  const technical = view === "tecnica";

  if (filters.vista === "inbox") {
    return <main className="container admin-shell">
      <AdminNav view={view} />
      <AdminPageHeader eyebrow="Comunicaciones" title="Inbox WhatsApp" description="Conversaciones reales con los contactos, con atención humana y respuesta manual." />
      <WhatsAppInbox />
    </main>;
  }

  if (filters.vista === "integraciones") {
    if (!technical) {
      return <main className="container admin-shell"><AdminNav view={view} /><AdminPageHeader eyebrow="Sistema" title="Centro técnico" description="Diagnóstico de canales e integraciones del CRM." /><AdminEmptyState icon="secure" title="Acceso restringido" description="Esta superficie contiene diagnóstico técnico y no forma parte de la vista Dirección." /></main>;
    }
    const [waRulesWithoutTemplate, waQueued] = await Promise.all([
      prisma.automationRule.count({ where: { channel: "WHATSAPP", status: { in: ["ACTIVE", "PAUSED"] }, OR: [{ waTemplateName: null }, { waTemplateName: "" }] } }),
      prisma.outboundMessage.count({ where: { channel: "WHATSAPP", status: "PROGRAMADO" } }),
    ]);
    return <main className="container admin-shell technical-center">
      <AdminNav view={view} />
      <AdminPageHeader eyebrow="Sistema" title="Centro técnico" description="Estado operativo, configuración y diagnóstico de los canales conectados al CRM." />
      <HealthStrip />
      <IntegrationStatusPanel technical />
      <details className="panel technical-tools">
        <summary><span><strong>Herramientas y comprobaciones</strong><small>Pruebas controladas, plantillas y diagnóstico detallado.</small></span><span>Mostrar</span></summary>
        <div className="technical-tools-body">
          <WhatsAppStatusPanel rulesWithoutTemplate={waRulesWithoutTemplate} queued={waQueued} />
          <WhatsAppTestPanel />
          <WhatsAppTemplateAudit />
          <EmailTestPanel />
          <TemplateManager />
        </div>
      </details>
    </main>;
  }

  const now = new Date();
  const visibleStatus = esEstadoVisible(filters.status) ? filters.status : undefined;
  const search = filters.q ?? filters.lead;
  const channel = filters.channel === "EMAIL" || filters.channel === "WHATSAPP" ? filters.channel : undefined;
  const where: Prisma.OutboundMessageWhereInput = {
    ...(channel ? { channel } : {}),
    ...(visibleStatus ? filtroDe(visibleStatus, now) : {}),
    ...(search ? { OR: [
      { lead: { fullName: { contains: search, mode: "insensitive" } } },
      { lead: { email: { contains: search, mode: "insensitive" } } },
      { toAddress: { contains: search, mode: "insensitive" } },
      { subject: { contains: search, mode: "insensitive" } },
    ] } : {}),
    ...(filters.course ? { enrollment: { courseId: filters.course } } : {}),
    ...(filters.from ? { AND: [{ scheduledAt: { gte: new Date(`${filters.from}T00:00:00-05:00`) } }] } : {}),
  };

  const [messages, courses, total, dispatchQueue, ready, requiresConfiguration, notDelivered] = await Promise.all([
    prisma.outboundMessage.findMany({ where, orderBy: { scheduledAt: "desc" }, take: 150, include: { lead: true, enrollment: { include: { course: true } } } }),
    prisma.course.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.outboundMessage.count({ where }),
    prisma.outboundMessage.count({ where: { OR: [{ status: "PROGRAMADO", scheduledAt: { lte: now } }, { status: "FALLIDO", attemptCount: { lt: 5 }, nextAttemptAt: { lte: now } }] } }),
    prisma.outboundMessage.count({ where: filtroDe("listo", now) }),
    prisma.outboundMessage.count({ where: filtroDe("requiere_config", now) }),
    prisma.outboundMessage.count({ where: filtroDe("no_entregado", now) }),
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
    createdAt: message.createdAt,
    sentAt: message.sentAt,
    acceptedAt: message.acceptedAt,
    deliveredAt: message.deliveredAt,
    readAt: message.readAt,
    bouncedAt: message.bouncedAt,
    failedAt: message.failedAt,
    cancelledAt: message.cancelledAt,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    error: message.error,
    providerName: message.providerName,
    providerMessageId: message.providerMessageId,
    attemptCount: message.attemptCount,
    isSimulation: message.isSimulation,
    leadName: message.lead.fullName,
    courseTitle: message.enrollment?.course.title ?? null,
    courseId: message.enrollment?.courseId ?? null,
  }));

  const hasFilters = Boolean(channel || visibleStatus || search || filters.course || filters.from);

  return <main className="container admin-shell">
    <AdminNav view={view} />
    <AdminPageHeader
      eyebrow="Comunicación"
      title="Comunicaciones"
      description="Historial operativo de lo enviado, programado y pendiente por contacto."
      actions={<DispatchButton simulation={isMessagingSimulation()} pendingCount={dispatchQueue} blockedCount={requiresConfiguration} />}
    />
    <ChannelModeBanner />

    <section className={`summary-line ${notDelivered > 0 || requiresConfiguration > 0 ? "is-attention" : ""}`} aria-label="Resumen de comunicaciones">
      <span><strong>{total}</strong> en la vista</span><span className="summary-sep">·</span>
      <Link href="/admin/mensajes?status=listo"><strong>{ready}</strong> listos</Link><span className="summary-sep">·</span>
      <Link href="/admin/mensajes?status=requiere_config"><strong>{requiresConfiguration}</strong> requieren configuración</Link><span className="summary-sep">·</span>
      <Link href="/admin/mensajes?status=no_entregado"><strong>{notDelivered}</strong> no entregados</Link>
      {technical ? <Link className="btn-sm ghost" href="/admin/mensajes?vista=integraciones">Abrir Centro técnico</Link> : null}
    </section>

    <form className="phase3-primary-filters">
      <div className="filter-bar phase3-message-filter-grid">
        <input name="q" aria-label="Buscar comunicación" defaultValue={search ?? ""} placeholder="Buscar contacto, correo o asunto" />
        <select name="channel" aria-label="Canal" defaultValue={channel ?? ""}><option value="">Todos los canales</option><option value="EMAIL">Correo</option><option value="WHATSAPP">WhatsApp</option></select>
        <select name="status" aria-label="Estado" defaultValue={visibleStatus ?? ""}><option value="">Todos los estados</option>{ESTADOS_VISIBLES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select>
        <select name="course" aria-label="Curso" defaultValue={filters.course ?? ""}><option value="">Todos los cursos</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select>
        <input name="from" type="date" defaultValue={filters.from ?? ""} aria-label="Desde esta fecha" />
        <div className="filter-actions"><button type="submit" className="btn-sm">Filtrar</button>{hasFilters ? <Link className="btn-sm ghost" href="/admin/mensajes">Quitar filtros</Link> : null}</div>
      </div>
    </form>

    <section className="panel phase3-table-panel">
      {rows.length === 0
        ? <AdminEmptyState icon="messages" title={hasFilters ? "No hay mensajes con estos filtros" : "Todavía no se ha enviado nada"} description={hasFilters ? "Prueba a quitar algún filtro." : "Cuando alguien se inscriba, su confirmación aparecerá aquí."} />
        : <MessageList messages={rows} now={now} technical={technical} />}
    </section>
  </main>;
}
