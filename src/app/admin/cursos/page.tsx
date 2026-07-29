import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminFilterPanel } from "../AdminFilterPanel";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { CourseManager, type CourseRow } from "./CourseManager";
import { CourseCatalogAudit } from "./CourseCatalogAudit";
import { loadCourseCatalogReport } from "@/lib/course-catalog-server";
import { canApplyCourseCatalog } from "@/lib/course-catalog";

export const dynamic = "force-dynamic";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string; new?: string }> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const status = filters.status === "inactive" ? "inactive" : filters.status === "all" ? "all" : "active";
  const canEdit = session?.role === "ADMIN" || session?.role === "MARKETING";
  const queryWithoutCreate = new URLSearchParams();
  if (filters.q) queryWithoutCreate.set("q", filters.q);
  queryWithoutCreate.set("status", status);
  if (filters.category) queryWithoutCreate.set("category", filters.category);
  const closeHref = `/admin/cursos?${queryWithoutCreate}`;
  const createHref = `${closeHref}&new=true`;
  const [courses, catalogReport] = await Promise.all([prisma.course.findMany({
    where: {
      ...(filters.q ? { OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { slug: { contains: filters.q, mode: "insensitive" } }] } : {}),
      ...(status === "active" ? { isPublished: true } : status === "inactive" ? { isPublished: false } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  }), session.role === "ADMIN" ? loadCourseCatalogReport() : Promise.resolve(null)]);
  const categories = await prisma.course.findMany({ distinct: ["category"], select: { category: true }, where: { category: { not: null } } });
  const rows: CourseRow[] = courses.map((course) => ({ ...course, price: course.price === null ? null : Number(course.price), startsAt: course.startsAt?.toISOString() ?? null, endsAt: course.endsAt?.toISOString() ?? null }));
  return (
    <main className="container admin-shell">
      <AdminNav />
      <AdminPageHeader
        eyebrow="Catálogo"
        title="Cursos"
        description="Organiza la oferta académica, su publicación y la información visible para los estudiantes."
        actions={canEdit ? <Link className="btn-sm" href={createHref} scroll={false}>Crear curso</Link> : null}
      />
      <form>
        <AdminFilterPanel label="Filtros del catálogo">
        <div className="filter-bar course-filter-bar">
        <input name="q" aria-label="Buscar cursos" defaultValue={filters.q} placeholder="Buscar por título o identificador" />
        <select name="status" aria-label="Estado del curso" defaultValue={status}><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option></select>
        <select name="category" aria-label="Categoría del curso" defaultValue={filters.category ?? ""}><option value="">Todas las categorías</option>{categories.map(({ category }) => <option key={category ?? ""}>{category}</option>)}</select>
        <button type="submit" className="btn-sm">Filtrar</button>
        </div>
        </AdminFilterPanel>
      </form>
      {catalogReport ? (
        <CourseCatalogAudit initialReport={catalogReport} canApply={canApplyCourseCatalog()} />
      ) : (
        <section className="panel admin-notice" aria-label="Permisos del catálogo oficial">
          La comparación e importación del catálogo oficial está disponible únicamente para administradores.
        </section>
      )}
      <CourseManager courses={rows} canEdit={canEdit} startCreating={filters.new === "true"} closeHref={closeHref} />
    </main>
  );
}
