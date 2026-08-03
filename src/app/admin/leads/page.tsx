import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminFilterPanel } from "../AdminFilterPanel";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { presentAdminValue } from "../adminPresentation";
import { NewContactForm } from "./NewContactForm";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" }).format(value);
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const page = Math.max(1, Number(filters.page) || 1);
  const session = await currentAdminSession();
  const canCreate = session?.role === "ADMIN" || session?.role === "VENTAS";
  const canExport = session.role === "ADMIN" || session.role === "VENTAS";
  const advancedFiltersActive = Boolean(filters.campaign || filters.source || filters.content || filters.term || filters.from || filters.to);
  const hasFilters = Boolean(
    filters.q || filters.stage || filters.course || filters.assignedTo || advancedFiltersActive
    || (filters.sort && filters.sort !== "newest") || filters.archived === "true",
  );
  const where: Prisma.LeadWhereInput = {
    isArchived: filters.archived === "true",
    ...(filters.q ? { OR: [
      { fullName: { contains: filters.q, mode: "insensitive" } },
      { firstName: { contains: filters.q, mode: "insensitive" } },
      { lastName: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
      { phone: { contains: filters.q } },
    ] } : {}),
    ...(filters.stage ? { stage: filters.stage as Prisma.EnumLeadStageFilter } : {}),
    ...(filters.course ? { OR: [
      { courseId: filters.course },
      { enrollments: { some: { courseId: filters.course } } },
    ] } : {}),
    ...(filters.campaign ? { utmCampaign: { contains: filters.campaign, mode: "insensitive" } } : {}),
    ...(filters.content ? { utmContent: { contains: filters.content, mode: "insensitive" } } : {}),
    ...(filters.term ? { utmTerm: { contains: filters.term, mode: "insensitive" } } : {}),
    ...(filters.source ? { AND: [{ OR: [{ source: { contains: filters.source, mode: "insensitive" } }, { utmSource: { contains: filters.source, mode: "insensitive" } }] }] } : {}),
    ...(filters.assignedTo ? { assignedToId: filters.assignedTo } : {}),
    ...(filters.from || filters.to ? { createdAt: { ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00-05:00`) } : {}), ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59-05:00`) } : {}) } } : {}),
  };
  const [leads, total, courses, users] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: filters.sort === "oldest" ? { createdAt: "asc" } : filters.sort === "score" ? { score: "desc" } : { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { course: true, enrollments: { include: { course: true } }, assignedTo: true },
    }),
    prisma.lead.count({ where }),
    prisma.course.findMany({ orderBy: { title: "asc" }, select: { id: true, title: true, isPublished: true } }),
    prisma.adminUser.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeCourses = courses.filter((course) => course.isPublished);
  const pageLink = (next: number) => {
    const params = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
    params.set("page", String(next));
    return `/admin/leads?${params}`;
  };
  return (
    <main className="container admin-shell">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Gestión comercial"
        title="Contactos"
        description="Consulta, segmenta y da seguimiento a cada persona interesada en la oferta de R.A. Training."
        actions={<>
          {canCreate ? <NewContactForm courses={activeCourses} users={users} /> : null}
          {canExport ? <a className="btn-sm ghost" href="/api/admin/leads/export">Exportar autorizados</a> : null}
          <Link className="btn-sm ghost" href={`/admin/leads?archived=${filters.archived === "true" ? "false" : "true"}`}>{filters.archived === "true" ? "Ver activos" : "Ver archivados"}</Link>
        </>}
      />
      <form>
        <AdminFilterPanel label="Filtros de contactos">
        <div className="contact-filters">
          <div className="contact-filter-grid">
            <label className="filter-field filter-field-search">
              <span>Buscar contactos</span>
              <input name="q" defaultValue={filters.q} placeholder="Nombre, correo o WhatsApp" />
              <small>Busca utilizando cualquiera de estos datos.</small>
            </label>
            <label className="filter-field">
              <span>Etapa</span>
              <select name="stage" defaultValue={filters.stage ?? ""}><option value="">Todas las etapas</option>{["NUEVO","INSCRITO","EN_CURSO","CERTIFICADO","OPORTUNIDAD","CLIENTE","PERDIDO"].map((stage) => <option key={stage} value={stage}>{presentAdminValue(stage)}</option>)}</select>
            </label>
            <label className="filter-field">
              <span>Curso</span>
              <select name="course" defaultValue={filters.course ?? ""}><option value="">Todos los cursos activos</option>{activeCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select>
            </label>
            <label className="filter-field">
              <span>Responsable</span>
              <select name="assignedTo" defaultValue={filters.assignedTo ?? ""}><option value="">Todos los responsables</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>
            </label>
          </div>

          <details className="advanced-filters" open={advancedFiltersActive}>
            <summary>
              <span>Más filtros</span>
              <small>{advancedFiltersActive ? "Filtros adicionales activos" : "Opcional"}</small>
            </summary>
            <div className="advanced-filter-grid">
              <label className="filter-field"><span>Campaña</span><input name="campaign" defaultValue={filters.campaign} /></label>
              <label className="filter-field"><span>Origen</span><input name="source" defaultValue={filters.source} /></label>
              <label className="filter-field"><span>Contenido UTM</span><input name="content" defaultValue={filters.content} /></label>
              <label className="filter-field"><span>Término UTM</span><input name="term" defaultValue={filters.term} /></label>
              <label className="filter-field"><span>Registrado desde</span><input name="from" type="date" defaultValue={filters.from} /></label>
              <label className="filter-field"><span>Registrado hasta</span><input name="to" type="date" defaultValue={filters.to} /></label>
            </div>
          </details>

          <div className="contact-filter-actions">
            <label className="filter-field filter-sort"><span>Ordenar por</span><select name="sort" defaultValue={filters.sort ?? "newest"}><option value="newest">Más recientes</option><option value="oldest">Más antiguos</option><option value="score">Mayor puntaje</option></select></label>
            <input type="hidden" name="archived" value={filters.archived ?? "false"} />
            <button type="submit" className="btn-sm">Aplicar filtros</button>
            <Link className="btn-sm ghost" href="/admin/leads">Limpiar filtros</Link>
          </div>
        </div>
        </AdminFilterPanel>
      </form>
      <div className="panel">
        {leads.length === 0 ? <AdminEmptyState
          icon="contacts"
          title={hasFilters ? "No encontramos resultados" : "Todavía no hay contactos"}
          description={hasFilters ? "Prueba con otros términos o limpia los filtros aplicados." : "Los registros del formulario y los contactos creados manualmente aparecerán aquí."}
          action={hasFilters
            ? <Link className="btn-sm ghost" href="/admin/leads">Limpiar filtros</Link>
            : canCreate ? <NewContactForm courses={activeCourses} users={users} /> : null}
        /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Contacto</th><th>WhatsApp</th><th>Etapa</th><th>Cursos</th><th>Origen</th><th>Responsable</th><th>Fecha</th></tr></thead>
            <tbody>{leads.map((lead) => <tr key={lead.id}>
              <td><Link href={`/admin/leads/${lead.id}`}><strong>{lead.fullName}</strong></Link>{lead.email ? <div className="muted">{lead.email}</div> : null}</td>
              <td><a href={lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, "")}` : undefined}>{lead.phone ?? "—"}</a></td>
              <td><span className="pill info">{presentAdminValue(lead.stage)}</span><div className="muted">Puntaje {lead.score}</div></td>
              <td>{[
                ...lead.enrollments.map((item) => item.course.title),
                ...(lead.course && !lead.enrollments.some((item) => item.courseId === lead.courseId) ? [`${lead.course.title} (interés)`] : []),
              ].join(", ") || "—"}</td>
              <td>{lead.utmSource ?? lead.source ?? "—"}<div className="muted">{lead.utmCampaign ?? ""}</div></td>
              <td>{lead.assignedTo?.name ?? "Sin asignar"}</td>
              <td>{formatDate(lead.createdAt)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
        <div className="pagination"><span className="muted">{total} contactos · página {page} de {pages}</span><div className="card-actions">{page > 1 && <Link className="btn-sm ghost" href={pageLink(page - 1)}>Anterior</Link>}{page < pages && <Link className="btn-sm ghost" href={pageLink(page + 1)}>Siguiente</Link>}</div></div>
      </div>
    </main>
  );
}
