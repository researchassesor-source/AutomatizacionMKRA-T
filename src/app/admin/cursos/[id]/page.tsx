import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { CONTENIDO } from "@/lib/auth/roles";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { resolveCourseSessions } from "@/lib/course-sessions";
import { buildCourseTimeline } from "@/lib/course-timeline";
import { formatDay, formatMoment, formatTime } from "@/lib/message-presentation";
import { AdminNav } from "../../AdminNav";
import { AdminPageHeader } from "../../AdminPageHeader";
import { TechnicalOnly } from "../../TechnicalDetail";
import { CourseTimeline } from "../CourseTimeline";
import { ScheduleSessionButton } from "../ScheduleSessionButton";
import { CourseSessionsPanel } from "./CourseSessionsPanel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "calendario", label: "Sesiones" },
  { key: "inscritos", label: "Inscritos" },
  { key: "comunicaciones", label: "Comunicaciones" },
] as const;

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  const tab = TABS.find((item) => item.key === filters.tab)?.key ?? "resumen";
  const canEdit = CONTENIDO.includes(session.role);

  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      sessions: { orderBy: { startAt: "asc" } },
      automationRules: {
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true, planKey: true, channel: true, status: true, trigger: true, offsetMinutes: true, requiresStreamUrl: true, waTemplateName: true },
      },
      _count: { select: { enrollments: true } },
    },
  });
  if (!course) notFound();

  const sessions = resolveCourseSessions(course, course.sessions);
  const proxima = sessions.find((item) => item.startAt.getTime() >= Date.now()) ?? sessions[0] ?? null;
  const steps = buildCourseTimeline({ rules: course.automationRules, sessions });
  const sinFecha = sessions.length === 0;

  const [inscritos, enviados, programados, bloqueados] = await Promise.all([
    prisma.enrollment.findMany({
      where: { courseId: id },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, createdAt: true, status: true, lead: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.outboundMessage.count({ where: { enrollment: { courseId: id }, status: { in: ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO"] } } }),
    prisma.outboundMessage.count({ where: { enrollment: { courseId: id }, status: "PROGRAMADO" } }),
    prisma.outboundMessage.count({ where: { enrollment: { courseId: id }, status: "OMITIDO", scheduledAt: { gt: new Date() } } }),
  ]);

  function tabHref(key: string) {
    return `/admin/cursos/${id}?tab=${key}`;
  }

  return (
    <main className="container admin-shell">
      <AdminNav view={view} />
      <Link className="back-link" href="/admin/cursos">← Volver a Cursos</Link>
      <AdminPageHeader
        eyebrow="Curso"
        title={course.title}
        description={[
          course.modality,
          `${course._count.enrollments} inscrito${course._count.enrollments === 1 ? "" : "s"}`,
          course.isPublished ? "Publicado" : "No publicado",
        ].filter(Boolean).join(" · ")}
        actions={sinFecha && canEdit ? (
          <ScheduleSessionButton
            courseId={course.id}
            courseTitle={course.title}
            enrollments={course._count.enrollments}
            modality={course.modality}
          />
        ) : null}
      />

      {sinFecha ? (
        <section className="summary-line is-attention">
          <strong>Sesión pendiente de programar.</strong>
          {course._count.enrollments > 0
            ? ` ${course._count.enrollments} ${course._count.enrollments === 1 ? "persona está inscrita" : "personas están inscritas"} y sus recordatorios no pueden calcularse hasta que definas fecha y hora.`
            : " Define fecha y hora para que las automatizaciones puedan calcularse."}
        </section>
      ) : proxima && !proxima.streamUrl ? (
        <section className="summary-line is-attention">
          <strong>El enlace de acceso todavía está pendiente.</strong>
          {" Puedes añadirlo más adelante. Los recordatorios que necesiten el enlace no se enviarán hasta que esté disponible."}
        </section>
      ) : null}

      <nav className="tabs" aria-label="Secciones del curso">
        {TABS.map((item) => (
          <Link key={item.key} href={tabHref(item.key)} className={tab === item.key ? "is-active" : ""} aria-current={tab === item.key ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "resumen" ? (
          <section className="panel">
            <h2>Datos del curso</h2>
            <dl className="data-grid">
              <div><dt>Modalidad</dt><dd>{course.modality ?? <span className="muted">No especificada</span>}</dd></div>
              <div><dt>Próxima sesión</dt><dd>{proxima ? `${formatDay(proxima.startAt)} · ${formatTime(proxima.startAt)}` : <span className="muted">Pendiente de programar</span>}</dd></div>
              <div><dt>Sesiones registradas</dt><dd>{sessions.length}</dd></div>
              <div><dt>Inscritos</dt><dd>{course._count.enrollments}</dd></div>
              <div><dt title="Correos que el proveedor ya aceptó para este curso.">Comunicaciones enviadas</dt><dd>{enviados}</dd></div>
              <div><dt title="Listas y esperando su hora.">Programadas</dt><dd>{programados}</dd></div>
              {bloqueados > 0 ? <div><dt title="Futuras, pero les falta el enlace de la reunión.">Esperan enlace</dt><dd>{bloqueados}</dd></div> : null}
              <div><dt>Duración</dt><dd>{course.duration ?? <span className="muted">No especificada</span>}</dd></div>
              <div><dt>Categoría</dt><dd>{course.category ?? <span className="muted">Sin categoría</span>}</dd></div>
              <div><dt>Creado</dt><dd>{formatMoment(course.createdAt)}</dd></div>
            </dl>
            <p className="course-links">
              <a href={course.officialCourseUrl} target="_blank" rel="noopener noreferrer">Página pública del curso</a>
              {course.moodleCourseUrl ? <> · <a href={course.moodleCourseUrl} target="_blank" rel="noopener noreferrer">Aula virtual</a></> : null}
            </p>
            <TechnicalOnly>{course.id}</TechnicalOnly>
            <TechnicalOnly>{course.slug}</TechnicalOnly>
            {course.externalId ? <TechnicalOnly>{`${course.externalSource}:${course.externalId}`}</TechnicalOnly> : null}
          </section>
      ) : null}

      {tab === "inscritos" ? (
          <section className="panel">
            <h2>Personas inscritas</h2>
            {inscritos.length === 0 ? (
              <p className="muted">Todavía no hay nadie inscrito en este curso.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Persona</th><th>Correo</th><th>Estado</th><th>Se inscribió</th></tr></thead>
                  <tbody>
                    {inscritos.map((item) => (
                      <tr key={item.id}>
                        <td><Link className="row-title" href={`/admin/leads/${item.lead.id}`}>{item.lead.fullName}</Link></td>
                        <td className="muted">{item.lead.email}</td>
                        <td>{item.status === "INSCRITO" ? "Inscrito" : item.status === "COMPLETADO" ? "Completado" : item.status === "EN_CURSO" ? "En curso" : "Interesado"}</td>
                        <td className="muted">{formatMoment(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
      ) : null}

      {tab === "calendario" ? (
        <CourseSessionsPanel
          courseId={course.id}
          courseTitle={course.title}
          enrollments={course._count.enrollments}
          modality={course.modality}
          canEdit={canEdit}
          courseStreamUrl={course.streamUrl}
          sessions={course.sessions.map((item) => ({
            id: item.id,
            title: item.title,
            startAt: item.startAt.toISOString(),
            endAt: item.endAt?.toISOString() ?? null,
            streamUrl: item.streamUrl,
          }))}
        />
      ) : null}

      {tab === "comunicaciones" ? (
        <section className="panel">
          <h2>Qué recibe cada inscrito</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 18 }}>
            El recorrido completo desde que alguien se inscribe hasta que termina el curso.
          </p>
          <CourseTimeline hasSchedule={sessions.length > 0} steps={steps} />
        </section>
      ) : null}
    </main>
  );
}
