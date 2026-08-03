import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminEmptyState } from "../../AdminEmptyState";
import { AdminNav } from "../../AdminNav";
import { AdminPageHeader } from "../../AdminPageHeader";
import { presentAdminValue } from "../../adminPresentation";
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
        enrollments: { include: { course: true }, orderBy: { createdAt: "desc" } },
        notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
        followUps: { include: { assignedTo: true }, orderBy: { dueAt: "asc" } },
        messages: { orderBy: { createdAt: "desc" }, take: 30 },
        events: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    }),
    prisma.adminUser.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.course.findMany({ where: { isPublished: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    currentAdminSession(),
  ]);
  if (!lead) notFound();
  const relatedAudits = await prisma.auditLog.findMany({
    where: { OR: [
      { entityType: "Lead", entityId: lead.id },
      { entityType: "Enrollment", entityId: { in: lead.enrollments.map((item) => item.id) } },
    ] },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const serializedLead = {
    id: lead.id, firstName: lead.firstName, lastName: lead.lastName, fullName: lead.fullName,
    email: lead.email, phone: lead.phone, stage: lead.stage, source: lead.source,
    utmSource: lead.utmSource, utmMedium: lead.utmMedium, utmCampaign: lead.utmCampaign,
    utmContent: lead.utmContent, utmTerm: lead.utmTerm,
    landingUrl: lead.landingUrl, referrer: lead.referrer, consent: lead.consent,
    consentAt: lead.consentAt?.toISOString() ?? null, isArchived: lead.isArchived,
    assignedToId: lead.assignedToId, lostReason: lead.lostReason,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null, score: lead.score,
  };
  const enrollments = lead.enrollments.map((item) => ({
    id: item.id, status: item.status, financeStatus: item.financeStatus,
    certificateStatus: item.certificateStatus, financeInscripcionId: item.financeInscripcionId,
    moodleCompletionDate: item.moodleCompletionDate?.toISOString() ?? null,
    source: item.source, utmSource: item.utmSource, utmMedium: item.utmMedium,
    utmCampaign: item.utmCampaign, utmContent: item.utmContent, utmTerm: item.utmTerm,
    landingUrl: item.landingUrl, referrer: item.referrer,
    course: { title: item.course.title, officialCourseUrl: item.course.officialCourseUrl, moodleCourseUrl: item.course.moodleCourseUrl },
  }));
  return (
    <main className="container admin-shell">
      <AdminNav />
      <AdminPageHeader eyebrow="Detalle del contacto" title={lead.fullName} description="Información comercial, historial y próximos pasos de este contacto." actions={<span className="pill info">{presentAdminValue(lead.stage)}</span>} />
      <LeadDetailManager
        lead={serializedLead}
        enrollments={enrollments}
        interestCourse={lead.course ? { id: lead.course.id, title: lead.course.title } : null}
        courses={courses}
        users={users}
        role={session.role}
      />
      <div className="grid">
        <section className="panel"><h2>Notas</h2>{lead.notes.length === 0 ? <AdminEmptyState icon="contacts" title="Sin notas" description="Las notas del equipo aparecerán aquí." /> : lead.notes.map((note) => <article className="timeline-item" key={note.id}><strong>{note.author?.name ?? "Equipo CRM"}</strong><p>{note.content}</p><small>{formatDate(note.createdAt)}</small></article>)}</section>
        <section className="panel"><h2>Próximas acciones</h2>{lead.followUps.length === 0 ? <AdminEmptyState icon="calendar" title="Sin seguimientos" description="Las próximas acciones programadas aparecerán aquí." /> : lead.followUps.map((item) => <article className="timeline-item" key={item.id}><strong>{presentAdminValue(item.type)} · {presentAdminValue(item.status)}</strong><p>{item.notes ?? "Sin detalle"}</p><small>{formatDate(item.dueAt)} · {item.assignedTo?.name ?? "Sin asignar"}</small></article>)}</section>
      </div>
      <section className="panel"><h2>Auditoría relacionada</h2>{relatedAudits.length === 0 ? <AdminEmptyState icon="audit" title="Sin eventos de auditoría" description="Las acciones administrativas relacionadas aparecerán aquí." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Resultado</th><th>Referencia</th></tr></thead><tbody>{relatedAudits.map((event) => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td>{event.actorEmail ?? "Sistema"}</td><td>{presentAdminValue(event.action)}</td><td>{presentAdminValue(event.result)}</td><td>{event.entityId ?? "—"}</td></tr>)}</tbody></table></div>}</section>
      <div className="grid">
        <section className="panel"><h2>Mensajes</h2>{lead.messages.length === 0 ? <AdminEmptyState icon="messages" title="Sin mensajes" description="Los mensajes asociados aparecerán aquí." /> : lead.messages.map((message) => <article className="timeline-item" key={message.id}><strong>{presentAdminValue(message.channel)} · {presentAdminValue(message.status)}</strong><p>{message.subject ?? message.body.slice(0, 140)}</p><small>{formatDate(message.createdAt)}</small></article>)}</section>
        <section className="panel"><h2>Actividad</h2>{lead.events.length === 0 ? <AdminEmptyState icon="activity" title="Sin actividad registrada" description="Los eventos del contacto aparecerán aquí." /> : lead.events.map((event) => <article className="timeline-item" key={event.id}><strong>{presentAdminValue(event.type)}</strong><small>{formatDate(event.createdAt)}</small></article>)}</section>
      </div>
    </main>
  );
}
