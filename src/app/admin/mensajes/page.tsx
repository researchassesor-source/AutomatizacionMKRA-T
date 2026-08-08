import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { ChannelModeBanner } from "../ChannelModeBanner";
import { IntegrationStatusPanel } from "../IntegrationStatusPanel";
import { DispatchButton } from "./DispatchButton";
import { EmailTestPanel } from "./EmailTestPanel";
import { MessageList, type MessageRow } from "./MessageList";
import { TemplateManager } from "./TemplateManager";
import { WhatsAppStatusPanel } from "./WhatsAppStatusPanel";
import { WhatsAppTestPanel } from "./WhatsAppTestPanel";
import { isMessagingSimulation } from "@/lib/nurture/engine";
import { ESTADOS_VISIBLES, esEstadoVisible, filtroDe } from "@/lib/message-states";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!["ADMIN", "DIRECCION", "MARKETING", "VENTAS"].includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar mensajes." /></main>;
  }
  const tecnico = view === "tecnica";

  /**
   * Un unico instante para toda la pantalla.
   *
   * Los contadores y la lista se resuelven en consultas distintas. Si cada una
   * llamara a `new Date()` por su cuenta, un mensaje programado justo en medio
   * podria contarse como "listo para enviar" y aparecer como "programado" en
   * la tabla de al lado. Es raro, pero cuando ocurre destruye la confianza en
   * la pantalla entera y no deja rastro para investigarlo.
   */
  const ahora = new Date();

  const estadoFiltrado = esEstadoVisible(filters.status) ? filters.status : undefined;
  const where: Prisma.OutboundMessageWhereInput = {
    ...(filters.channel ? { channel: filters.channel as "EMAIL" | "WHATSAPP" } : {}),
    ...(estadoFiltrado ? filtroDe(estadoFiltrado, ahora) : {}),
    ...(filters.lead ? { lead: { fullName: { contains: filters.lead, mode: "insensitive" } } } : {}),
    ...(filters.course ? { enrollment: { courseId: filters.course } } : {}),
    // El filtro por fecha se combina con el del estado, que tambien usa
    // scheduledAt: `AND` los mantiene a los dos en lugar de pisar uno.
    ...(filters.from ? { AND: [{ scheduledAt: { gte: new Date(`${filters.from}T00:00:00-05:00`) } }] } : {}),
  };

  /**
   * Cada cifra del resumen se cuenta con la MISMA consulta que usara el filtro
   * al que enlaza. Antes se escribian por separado y ya divergieron una vez:
   * el resumen anuncio "87 con problema" cuando no habia ninguno, porque
   * contaba como fallos avisos futuros que nadie habia intentado enviar.
   */
  const [messages, courses, dispatchQueue, waRulesWithoutTemplate, waQueued, listos, requierenConfig, noEntregados] = await Promise.all([
    prisma.outboundMessage.findMany({ where, orderBy: { scheduledAt: "desc" }, take: 150, include: { lead: true, enrollment: { include: { course: true } } } }),
    prisma.course.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    // Cola real del envio automatico: incluye los reintentos, que no son un
    // estado que Direccion necesite ver pero si trabajo pendiente de verdad.
    prisma.outboundMessage.count({ where: { OR: [{ status: "PROGRAMADO", scheduledAt: { lte: ahora } }, { status: "FALLIDO", attemptCount: { lt: 5 }, nextAttemptAt: { lte: ahora } }] } }),
    prisma.automationRule.count({ where: { channel: "WHATSAPP", status: { in: ["ACTIVE", "PAUSED"] }, OR: [{ waTemplateName: null }, { waTemplateName: "" }] } }),
    prisma.outboundMessage.count({ where: { channel: "WHATSAPP", status: "PROGRAMADO" } }),
    prisma.outboundMessage.count({ where: filtroDe("listo", ahora) }),
    prisma.outboundMessage.count({ where: filtroDe("requiere_config", ahora) }),
    prisma.outboundMessage.count({ where: filtroDe("no_entregado", ahora) }),
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
    courseId: message.enrollment?.courseId ?? null,
  }));

  const hayFiltro = Boolean(filters.channel || estadoFiltrado || filters.lead || filters.course || filters.from);

  return <main className="container admin-shell">
    <AdminNav view={view} />
    <AdminPageHeader
      eyebrow="Comunicación"
      title="Comunicaciones"
      description="Todo lo que el sistema envía a los contactos: qué salió, a quién y si llegó."
      actions={<DispatchButton simulation={isMessagingSimulation()} pendingCount={dispatchQueue} blockedCount={requierenConfig} />}
    />

    <ChannelModeBanner />

    <section className={`summary-line ${noEntregados > 0 || requierenConfig > 0 ? "is-attention" : ""}`}>
      <strong>{messages.length}</strong> mensaje{messages.length === 1 ? "" : "s"} en la vista
      {/* Cada cifra enlaza al filtro que la produce, y por construcción ese
          filtro devuelve exactamente esos mensajes. */}
      {listos > 0 ? <>
        <span className="summary-sep">·</span>
        <Link href="/admin/mensajes?status=listo"><strong>{listos}</strong> listos para enviar</Link>
      </> : null}
      {requierenConfig > 0 ? <>
        <span className="summary-sep">·</span>
        <Link href="/admin/mensajes?status=requiere_config"><strong>{requierenConfig}</strong> requieren configuración</Link>
      </> : null}
      {noEntregados > 0 ? <>
        <span className="summary-sep">·</span>
        <Link href="/admin/mensajes?status=no_entregado"><strong>{noEntregados}</strong> no entregados</Link>
      </> : null}
      {listos === 0 && requierenConfig === 0 && noEntregados === 0 ? <>
        <span className="summary-sep">·</span>
        todo al día
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
        <select name="status" aria-label="Estado" defaultValue={estadoFiltrado ?? ""}>
          <option value="">Todos los estados</option>
          {ESTADOS_VISIBLES.map((estado) => <option key={estado.key} value={estado.key}>{estado.label}</option>)}
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
        : <MessageList messages={rows} now={ahora} />}
    </section>

    {tecnico ? <>
      <IntegrationStatusPanel technical only={["email", "whatsapp", "cron"]} />
      <WhatsAppStatusPanel rulesWithoutTemplate={waRulesWithoutTemplate} queued={waQueued} />
      <WhatsAppTestPanel />
      <EmailTestPanel />
      <TemplateManager />
    </> : null}
  </main>;
}
