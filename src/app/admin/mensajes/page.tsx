import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminFilterPanel } from "../AdminFilterPanel";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { presentAdminValue } from "../adminPresentation";
import { DispatchButton } from "./DispatchButton";
import { MessageActions } from "./MessageActions";
import { TemplateManager } from "./TemplateManager";
import { TemplateActions } from "./TemplateActions";
import { isMessagingSimulation } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  if (!["ADMIN", "MARKETING", "VENTAS"].includes(session.role)) {
    return <main className="container admin-shell"><AdminNav /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar mensajes." /></main>;
  }
  const where: Prisma.OutboundMessageWhereInput = {
    ...(filters.channel ? { channel: filters.channel as "EMAIL" | "WHATSAPP" } : {}),
    ...(filters.status ? { status: filters.status as Prisma.EnumMessageStatusFilter } : {}),
    ...(filters.lead ? { lead: { fullName: { contains: filters.lead, mode: "insensitive" } } } : {}),
    ...(filters.course ? { enrollment: { courseId: filters.course } } : {}),
    ...(filters.from ? { scheduledAt: { gte: new Date(`${filters.from}T00:00:00-05:00`) } } : {}),
  };
  const [messages, courses, templates, pendingCount] = await Promise.all([
    prisma.outboundMessage.findMany({ where, orderBy: { scheduledAt: "desc" }, take: 200, include: { lead: true, enrollment: { include: { course: true } } } }),
    prisma.course.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.messageTemplate.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
    prisma.outboundMessage.count({ where: { status: "PROGRAMADO", scheduledAt: { lte: new Date() } } }),
  ]);
  const canManageTemplates = session?.role === "ADMIN" || session?.role === "MARKETING";
  return <main className="container admin-shell">
    <AdminNav />
    <AdminPageHeader eyebrow="Comunicación" title="Seguimiento · mensajes" description="Supervisa los envíos programados, sus resultados y las plantillas de comunicación." actions={<DispatchButton simulation={isMessagingSimulation()} pendingCount={pendingCount} />} />
    {isMessagingSimulation() ? <section className="admin-notice"><span>Modo seguro activo: los proveedores externos no recibirán mensajes.</span></section> : null}
    <form><AdminFilterPanel><div className="filter-bar"><select name="channel" aria-label="Filtrar por canal" defaultValue={filters.channel ?? ""}><option value="">Todos los canales</option><option value="EMAIL">Correo</option><option value="WHATSAPP">WhatsApp</option></select><select name="status" aria-label="Filtrar por estado" defaultValue={filters.status ?? ""}><option value="">Todos los estados</option>{["PROGRAMADO","ENVIANDO","ENVIADO","SIMULADO","FALLIDO","CANCELADO","OMITIDO"].map((status) => <option key={status} value={status}>{presentAdminValue(status)}</option>)}</select><select name="course" aria-label="Filtrar mensajes por curso" defaultValue={filters.course ?? ""}><option value="">Todos los cursos activos</option>{courses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select><input name="lead" aria-label="Buscar mensajes por contacto" defaultValue={filters.lead} placeholder="Buscar contacto" /><input name="from" type="date" defaultValue={filters.from} aria-label="Fecha desde" /><button type="submit" className="btn-sm">Filtrar</button><Link className="btn-sm ghost" href="/admin/mensajes">Limpiar</Link></div></AdminFilterPanel></form>
    <section className="panel">{messages.length === 0 ? <AdminEmptyState icon="messages" title="No hay mensajes con estos filtros" description="Ajusta los criterios de búsqueda o limpia los filtros." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Canal</th><th>Contacto</th><th>Curso</th><th>Contenido</th><th>Estado</th><th>Programado</th><th>Acciones</th></tr></thead><tbody>{messages.map((message) => <tr key={message.id}><td>{presentAdminValue(message.channel)}</td><td><Link href={`/admin/leads/${message.leadId}`}>{message.lead.fullName}</Link><div className="muted">{message.toAddress}</div></td><td>{message.enrollment?.course.title ?? "—"}</td><td><strong>{message.subject ?? "Sin asunto"}</strong><details><summary>Ver mensaje</summary><p className="message-body">{message.body}</p></details></td><td><span className={`pill ${message.status === "ENVIADO" ? "ok" : message.status === "FALLIDO" ? "err" : message.status === "PROGRAMADO" ? "warn" : "info"}`}>{presentAdminValue(message.status)}</span>{message.isSimulation && <div className="muted">Simulación segura</div>}{message.error && <div className="muted">{message.error}</div>}</td><td>{new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" }).format(message.scheduledAt)}</td><td><MessageActions id={message.id} status={message.status} /></td></tr>)}</tbody></table></div>}</section>
    {canManageTemplates && <TemplateManager />}
    <section className="panel"><h2>Plantillas</h2>{templates.length === 0 ? <AdminEmptyState icon="messages" title="Todavía no hay plantillas" description="Las plantillas administrables aparecerán aquí." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Nombre</th><th>Canal</th><th>Categoría</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{templates.map((template) => <tr key={template.id}><td>{template.name}</td><td>{presentAdminValue(template.channel)}</td><td>{template.category ?? "—"}</td><td><span className={`pill ${template.isActive ? "ok" : ""}`}>{template.isActive ? "Activa" : "Inactiva"}</span></td><td><TemplateActions template={{ id: template.id, name: template.name, channel: template.channel, subject: template.subject, body: template.body, category: template.category, isActive: template.isActive }} /></td></tr>)}</tbody></table></div>}</section>
  </main>;
}
