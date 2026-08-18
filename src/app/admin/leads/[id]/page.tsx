import { notFound } from "next/navigation";
import { courseAccessEligibility } from "@/lib/commerce/course-entitlement";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { resolveCourseSessions } from "@/lib/course-sessions";
import { financeEnrollmentUrl } from "@/lib/finance/client";
import { formatMoment, messageMoment } from "@/lib/message-presentation";
import { AdminEmptyState } from "../../AdminEmptyState";
import { AdminNav } from "../../AdminNav";
import { AdminPageHeader } from "../../AdminPageHeader";
import { presentAdminValue, presentAuditAction } from "../../adminPresentation";
import { LeadDetailManager } from "./LeadDetailManager";

export const dynamic = "force-dynamic";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" }).format(value);
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, users, courses, session] = await Promise.all([
    prisma.lead.findUnique({
      where: { id },
      include: {
        course: true,
        // `purchases` e `isFree` deciden el acceso operativo al curso.
        enrollments: { include: { course: { include: { sessions: true } }, purchases: { select: { status: true } } }, orderBy: { createdAt: "desc" } },
        notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
        followUps: { include: { assignedTo: true }, orderBy: { dueAt: "asc" } },
        messages: { orderBy: { scheduledAt: "desc" }, take: 30 },
        events: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    }),
    prisma.adminUser.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.course.findMany({ where: { isPublished: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    currentAdminSession(),
  ]);
  if (!lead) notFound();
  const view = await resolveViewMode(session.role);
  const relatedAudits = await prisma.auditLog.findMany({
    where: { OR: [
      { entityType: "Lead", entityId: lead.id },
      { entityType: "Enrollment", entityId: { in: lead.enrollments.map((item) => item.id) } },
    ] },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const auditOrigin = (action: string, actorEmail: string | null) => {
    if (action.startsWith("FORM_") || action.startsWith("CONTACT_")) return "Formulario web";
    if (!actorEmail) return "Sistema";
    return view === "tecnica" ? actorEmail : "Equipo CRM";
  };
  const serializedLead = {
    id: lead.id, firstName: lead.firstName, lastName: lead.lastName, fullName: lead.fullName,
    email: lead.email, phone: lead.phone, stage: lead.stage, source: lead.source,
    utmSource: lead.utmSource, utmMedium: lead.utmMedium, utmCampaign: lead.utmCampaign,
    utmContent: lead.utmContent, utmTerm: lead.utmTerm,
    landingUrl: lead.landingUrl, referrer: lead.referrer, consent: lead.consent,
    consentAt: lead.consentAt?.toISOString() ?? null, isArchived: lead.isArchived,
    classification: lead.classification,
    assignedToId: lead.assignedToId, lostReason: lead.lostReason,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null, score: lead.score,
  };
  const enrollments = lead.enrollments.map((item) => {
    const schedule = resolveCourseSessions(item.course, item.course.sessions);
    const first = schedule[0] ?? null;
    const last = schedule[schedule.length - 1] ?? null;
    return {
      id: item.id, status: item.status, financeStatus: item.financeStatus,
      // Se deriva, no se guarda: un estado persistido puede quedarse desfasado
      // respecto de las compras y entonces la pantalla miente.
      acceso: courseAccessEligibility(item.course, item, item.purchases),
      certificateStatus: item.certificateStatus, financeInscripcionId: item.financeInscripcionId,
      financeUrl: item.financeInscripcionId ? financeEnrollmentUrl(item.financeInscripcionId) : "",
      moodleCompletionDate: item.moodleCompletionDate?.toISOString() ?? null,
      source: item.source, utmSource: item.utmSource, utmMedium: item.utmMedium,
      utmCampaign: item.utmCampaign, utmContent: item.utmContent, utmTerm: item.utmTerm,
      landingUrl: item.landingUrl, referrer: item.referrer,
      course: {
        title: item.course.title,
        officialCourseUrl: item.course.officialCourseUrl,
        moodleCourseUrl: item.course.moodleCourseUrl,
        modality: item.course.modality,
        startDate: first?.startAt.toISOString() ?? null,
        endDate: last ? (last.endAt ?? last.startAt).toISOString() : null,
      },
    };
  });
  return (
    <main className="container admin-shell">
      <AdminNav view={view} />
      <AdminPageHeader eyebrow="Detalle del contacto" title={lead.fullName} description="Información comercial, historial y próximos pasos de este contacto." actions={<span className="pill info">{presentAdminValue(lead.stage)}</span>} />
      <LeadDetailManager
        lead={serializedLead}
        enrollments={enrollments}
        interestCourse={lead.course ? { id: lead.course.id, title: lead.course.title } : null}
        courses={courses}
        role={session.role}
      />
      {lead.notes.length > 0 || lead.followUps.length > 0 ? <div className="grid">
        {lead.notes.length > 0 ? <section className="panel"><h2>Notas</h2>{lead.notes.map((note) => <article className="timeline-item" key={note.id}><strong>{note.author?.name ?? "Equipo CRM"}</strong><p>{note.content}</p><small>{formatDate(note.createdAt)}</small></article>)}</section> : null}
        {lead.followUps.length > 0 ? <section className="panel"><h2>Próximas acciones</h2>{lead.followUps.map((item) => <article className="timeline-item" key={item.id}><strong>{presentAdminValue(item.type)} · {presentAdminValue(item.status)}</strong><p>{item.notes ?? "Sin detalle"}</p><small>{formatDate(item.dueAt)} · {item.assignedTo?.name ?? "Sin asignar"}</small></article>)}</section> : null}
      </div> : null}
      <section className="panel contact-audit"><h2>Historial administrativo</h2>{relatedAudits.length === 0 ? <AdminEmptyState icon="audit" title="Sin eventos administrativos" description="Las acciones relacionadas con este contacto aparecerán aquí." /> : <div className="table-wrap"><table className="data audit-human-table"><thead><tr><th>Fecha</th><th>Origen</th><th>Acción</th><th>Resultado</th></tr></thead><tbody>{relatedAudits.map((event) => <tr key={event.id}><td data-label="Fecha">{formatDate(event.createdAt)}</td><td data-label="Origen">{auditOrigin(event.action, event.actorEmail)}</td><td data-label="Acción">{presentAuditAction(event.action)}</td><td data-label="Resultado">{presentAdminValue(event.result)}</td></tr>)}</tbody></table></div>}</section>
      <section className="panel contact-messages"><h2>Mensajes</h2>{lead.messages.length === 0 ? <AdminEmptyState icon="messages" title="Sin mensajes" description="Los mensajes asociados aparecerán aquí." /> : lead.messages.map((message) => {
        const moment = messageMoment(message);
        return <article className="timeline-item" key={message.id}><strong>{presentAdminValue(message.channel)} · {presentAdminValue(message.status)}</strong><p>{message.subject ?? message.body.slice(0, 140)}</p><small>{moment.label}: {formatMoment(moment.at)}</small></article>;
      })}</section>
      {lead.events.length > 0 ? <details className="panel contact-activity-details"><summary>Ver actividad del formulario ({lead.events.length})</summary><div>{lead.events.map((event) => <article className="timeline-item" key={event.id}><strong>{presentAdminValue(event.type)}</strong><small>{formatDate(event.createdAt)}</small></article>)}</div></details> : null}
    </main>
  );
}
