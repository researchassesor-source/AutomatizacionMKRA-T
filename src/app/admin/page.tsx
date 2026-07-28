import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import { AdminNav } from "./AdminNav";
import { AdminPageHeader } from "./AdminPageHeader";

export const dynamic = "force-dynamic";

type SummaryItem = {
  number: number;
  label: string;
  href: string;
  icon: AdminIconName;
  tone?: "err" | "info" | "ok" | "warn";
};

function OperationalPanel({
  title,
  description,
  icon,
  href,
  action,
  items,
}: {
  title: string;
  description: string;
  icon: AdminIconName;
  href: string;
  action: string;
  items: SummaryItem[];
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-heading">
          <span className="panel-heading-icon"><AdminIcon name={icon} size={18} /></span>
          <div><h2>{title}</h2><p>{description}</p></div>
        </div>
        <Link className="panel-link" href={href}>{action} <AdminIcon name="arrow" size={14} /></Link>
      </div>
      <div className="dashboard-summary-list">
        {items.map((item) => (
          <Link className="dashboard-summary-item" href={item.href} key={item.label}>
            <span className="dashboard-summary-icon"><AdminIcon name={item.icon} size={17} /></span>
            <span><strong>{item.label}</strong><small>Información actual del CRM</small></span>
            <span className={`pill ${item.tone ?? "info"}`}>{item.number}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default async function AdminDashboard() {
  await currentAdminSession();
  const now = new Date();
  const [contacts, opportunities, clients, enrollments, messages, posts, overdue, activeCourses] = await Promise.all([
    prisma.lead.count({ where: { isArchived: false } }),
    prisma.lead.count({ where: { stage: "OPORTUNIDAD", isArchived: false } }),
    prisma.lead.count({ where: { stage: "CLIENTE", isArchived: false } }),
    prisma.enrollment.count(),
    prisma.outboundMessage.count({ where: { status: "PROGRAMADO" } }),
    prisma.socialPost.count({ where: { status: "PROGRAMADO" } }),
    prisma.followUp.count({ where: { status: { in: ["PENDIENTE", "VENCIDO"] }, dueAt: { lt: now } } }),
    prisma.course.count({ where: { isPublished: true } }),
  ]);

  const stats: SummaryItem[] = [
    { number: contacts, label: "Contactos activos", href: "/admin/leads", icon: "contacts" },
    { number: enrollments, label: "Inscripciones", href: "/admin/leads", icon: "courses" },
    { number: opportunities, label: "Oportunidades", href: "/admin/ventas", icon: "activity" },
    { number: clients, label: "Clientes", href: "/admin/ventas", icon: "sales" },
    { number: overdue, label: "Seguimientos vencidos", href: "/admin/seguimientos?view=overdue", icon: "alert" },
    { number: messages, label: "Mensajes pendientes", href: "/admin/mensajes", icon: "messages" },
    { number: posts, label: "Publicaciones programadas", href: "/admin/redes", icon: "social" },
    { number: activeCourses, label: "Cursos activos", href: "/admin/cursos", icon: "courses" },
  ];

  return (
    <main className="container admin-shell">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Visión general"
        title="Resumen"
        description="Consulta el estado comercial, los seguimientos y la actividad reciente."
      />

      <section className="stat-grid" aria-label="Indicadores principales">
        {stats.map(({ number, label, href, icon }) => (
          <Link href={href} className="stat stat-link" key={label}>
            <div className="stat-head">
              <span className="stat-icon"><AdminIcon name={icon} size={19} /></span>
              <AdminIcon className="stat-arrow" name="arrow" size={17} />
            </div>
            <div className="n">{number}</div>
            <div className="l">{label}</div>
          </Link>
        ))}
      </section>

      <div className="admin-notice">
        <AdminIcon name="secure" size={18} />
        <span>Las acciones sensibles conservan sus controles y registros de auditoría.</span>
      </div>

      <div className="grid dashboard-grid">
        <OperationalPanel
          title="Prioridades comerciales"
          description="Señales que requieren atención del equipo."
          icon="alert"
          href="/admin/seguimientos?view=overdue"
          action="Revisar"
          items={[
            { number: overdue, label: "Seguimientos vencidos", href: "/admin/seguimientos?view=overdue", icon: "followups", tone: overdue ? "err" : "ok" },
            { number: opportunities, label: "Oportunidades abiertas", href: "/admin/ventas", icon: "activity", tone: "info" },
          ]}
        />
        <OperationalPanel
          title="Pipeline comercial"
          description="Panorama de relaciones activas y cierres."
          icon="sales"
          href="/admin/ventas"
          action="Abrir pipeline"
          items={[
            { number: contacts, label: "Contactos activos", href: "/admin/leads", icon: "contacts", tone: "info" },
            { number: clients, label: "Clientes confirmados", href: "/admin/ventas", icon: "sales", tone: "ok" },
          ]}
        />
        <OperationalPanel
          title="Actividad académica"
          description="Oferta publicada y participación registrada."
          icon="courses"
          href="/admin/cursos"
          action="Ver catálogo"
          items={[
            { number: activeCourses, label: "Cursos activos", href: "/admin/cursos", icon: "courses", tone: "ok" },
            { number: enrollments, label: "Inscripciones", href: "/admin/leads", icon: "contacts", tone: "info" },
          ]}
        />
        <OperationalPanel
          title="Automatización"
          description="Tareas programadas de comunicación y contenido."
          icon="messages"
          href="/admin/mensajes"
          action="Gestionar"
          items={[
            { number: messages, label: "Mensajes pendientes", href: "/admin/mensajes", icon: "messages", tone: messages ? "warn" : "ok" },
            { number: posts, label: "Publicaciones programadas", href: "/admin/redes", icon: "social", tone: posts ? "warn" : "ok" },
          ]}
        />
      </div>
    </main>
  );
}
