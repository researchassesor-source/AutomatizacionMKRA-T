import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminFilterPanel } from "../AdminFilterPanel";
import { AdminNav } from "../AdminNav";
import { CourseCommunications } from "./CourseCommunications";
import { CourseCards } from "./CourseCards";
import { buildCourseTimeline } from "@/lib/course-timeline";
import { resolveCourseSessions } from "@/lib/course-sessions";
import { AdminPageHeader } from "../AdminPageHeader";
import { CourseManager, type CourseRow } from "./CourseManager";
import { CourseSchedulePanel, type ScheduledCourse } from "./CourseSchedulePanel";
import { CRM_PUBLIC_URL } from "@/data/course-capture-mapping";
import { wordpressCatalogConfigured } from "@/lib/wordpress-catalog";
import { WordPressCatalogSync, type SyncMetadata } from "./WordPressCatalogSync";

export const dynamic = "force-dynamic";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; category?: string; new?: string }> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  const status = filters.status === "inactive" ? "inactive" : filters.status === "all" ? "all" : "active";
  const canEdit = ["ADMIN", "DIRECCION", "MARKETING"].includes(session?.role ?? "");
  const tecnico = view === "tecnica";
  const queryWithoutCreate = new URLSearchParams();
  if (filters.q) queryWithoutCreate.set("q", filters.q);
  queryWithoutCreate.set("status", status);
  if (filters.category) queryWithoutCreate.set("category", filters.category);
  const closeHref = `/admin/cursos?${queryWithoutCreate}`;
  const createHref = `${closeHref}&new=true`;
  const [courses, syncedCourses, latestSyncRun] = await Promise.all([prisma.course.findMany({
    where: {
      ...(filters.q ? { OR: [{ title: { contains: filters.q, mode: "insensitive" } }, { slug: { contains: filters.q, mode: "insensitive" } }] } : {}),
      ...(status === "active" ? { isPublished: true } : status === "inactive" ? { isPublished: false } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  }), view === "tecnica" ? prisma.course.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      externalId: true,
      externalSource: true,
      officialUrl: true,
      syncStatus: true,
      syncError: true,
      isPublished: true,
      acceptsRegistrations: true,
      lastSyncedAt: true,
    },
    orderBy: [{ isPublished: "desc" }, { displayOrder: "asc" }, { title: "asc" }],
  }) : Promise.resolve([]), view === "tecnica" ? prisma.catalogSyncRun.findFirst({ where: { source: "wordpress" }, orderBy: { startedAt: "desc" } }) : Promise.resolve(null)]);
  const categories = await prisma.course.findMany({ distinct: ["category"], select: { category: true }, where: { category: { not: null } } });
  const rows: CourseRow[] = courses.map((course) => ({ ...course, price: course.price === null ? null : Number(course.price), startsAt: course.startsAt?.toISOString() ?? null, endsAt: course.endsAt?.toISOString() ?? null }));
  const scheduledCourses = await prisma.course.findMany({
    where: { isPublished: true },
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
    include: {
      sessions: { orderBy: { startAt: "asc" } },
      automationRules: {
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true, planKey: true, channel: true, status: true, trigger: true, offsetMinutes: true, requiresStreamUrl: true, waTemplateName: true },
      },
      _count: { select: { enrollments: true, automationRules: true } },
    },
  });
  // Que recibe cada inscrito de cada curso y cuando. Se calcula en el servidor
  // para que la pantalla no tenga que saber nada del modelo de reglas.
  const totalInscritos = scheduledCourses.reduce((suma, course) => suma + course._count.enrollments, 0);
  const cursosSinFecha = scheduledCourses.filter((course) => resolveCourseSessions(course, course.sessions).length === 0).length;
  const comunicaciones = scheduledCourses.map((course) => {
    const sessions = resolveCourseSessions(course, course.sessions);
    return {
      id: course.id,
      title: course.title,
      enrollments: course._count.enrollments,
      nextSessionAt: sessions.find((item) => item.startAt.getTime() >= Date.now())?.startAt.toISOString()
        ?? sessions[0]?.startAt.toISOString() ?? null,
      steps: buildCourseTimeline({ rules: course.automationRules, sessions }).map((step) => ({
        ...step,
        scheduledAt: step.scheduledAt?.toISOString() ?? null,
      })),
      hasSchedule: sessions.length > 0,
    };
  });
  const schedules: ScheduledCourse[] = scheduledCourses.map((course) => ({
    id: course.id,
    slug: course.slug,
    title: course.title,
    startsAt: course.startsAt?.toISOString() ?? null,
    endsAt: course.endsAt?.toISOString() ?? null,
    streamUrl: course.streamUrl,
    enrollments: course._count.enrollments,
    automations: course._count.automationRules,
    sessions: course.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      startAt: session.startAt.toISOString(),
      endAt: session.endAt?.toISOString() ?? null,
      streamUrl: session.streamUrl,
    })),
  }));
  return (
    <main className="container admin-shell">
      <AdminNav view={view} />
      <AdminPageHeader
        eyebrow="Catálogo"
        title="Cursos"
        description="El catálogo, sus fechas y lo que recibe cada inscrito."
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
      <section className={`summary-line ${cursosSinFecha > 0 ? "is-attention" : ""}`}>
        <strong>{scheduledCourses.length}</strong> curso{scheduledCourses.length === 1 ? "" : "s"} publicado{scheduledCourses.length === 1 ? "" : "s"}
        <span className="summary-sep">·</span>
        <strong>{totalInscritos}</strong> inscrito{totalInscritos === 1 ? "" : "s"}
        {cursosSinFecha > 0 ? <>
          <span className="summary-sep">·</span>
          <strong>{cursosSinFecha}</strong> sin sesión programada
        </> : null}
        <span className="summary-actions">
          <a className="btn-sm ghost" href="https://ra-training.com/courses-1/" target="_blank" rel="noopener noreferrer">Ver catálogo oficial</a>
        </span>
      </section>

      <section className="panel">
        <h2>Cursos publicados</h2>
        <CourseCards canEdit={canEdit} courses={scheduledCourses.map((course) => {
          const sessions = resolveCourseSessions(course, course.sessions);
          const proxima = sessions.find((item) => item.startAt.getTime() >= Date.now()) ?? sessions[0] ?? null;
          return {
            id: course.id,
            title: course.title,
            modality: course.modality,
            enrollments: course._count.enrollments,
            nextSessionAt: proxima?.startAt.toISOString() ?? null,
            hasStreamUrl: Boolean(proxima?.streamUrl),
            sessionsCount: sessions.length,
            isPublished: course.isPublished,
          };
        })} />
      </section>

      <CourseCommunications courses={comunicaciones} />
      {tecnico ? (
        <WordPressCatalogSync
          configured={wordpressCatalogConfigured()}
          latestRun={latestSyncRun ? {
            ...latestSyncRun,
            metadata: latestSyncRun.metadata as SyncMetadata | null,
            startedAt: latestSyncRun.startedAt.toISOString(),
            completedAt: latestSyncRun.completedAt?.toISOString() ?? null,
          } : null}
          courses={syncedCourses.map((course) => ({
            ...course,
            lastSyncedAt: course.lastSyncedAt?.toISOString() ?? null,
          }))}
        />
      ) : null}
      <CourseSchedulePanel courses={schedules} canEdit={canEdit} publicOrigin={process.env.APP_URL?.replace(/\/$/, "") || CRM_PUBLIC_URL} />
      <CourseManager courses={rows} canEdit={canEdit} startCreating={filters.new === "true"} closeHref={closeHref} />
    </main>
  );
}
