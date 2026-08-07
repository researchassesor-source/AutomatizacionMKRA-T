import { AdminEmptyState } from "../AdminEmptyState";
import { CourseTimeline } from "./CourseTimeline";
import { formatMoment } from "@/lib/message-presentation";

export type CourseCommunicationsCourse = {
  id: string;
  title: string;
  enrollments: number;
  nextSessionAt: string | null;
  hasSchedule: boolean;
  steps: Array<{
    planKey: string;
    when: string;
    title: string;
    detail: string;
    channels: Array<"EMAIL" | "WHATSAPP">;
    scheduledAt: string | null;
    active: boolean;
    blockedReason: string | null;
    ruleNames: string[];
  }>;
};

/**
 * Comunicaciones por curso.
 *
 * Un curso por bloque plegable, abierto solo si algo le impide funcionar. Asi
 * la pantalla no obliga a revisar los nueve cursos para descubrir que a uno le
 * falta un enlace: los que necesitan atencion ya estan abiertos.
 */
export function CourseCommunications({ courses }: { courses: CourseCommunicationsCourse[] }) {
  if (courses.length === 0) {
    return (
      <section className="panel">
        <h2>Comunicaciones por curso</h2>
        <AdminEmptyState icon="messages" title="Todavía no hay cursos publicados" description="Publica un curso para ver qué recibirán sus inscritos." />
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Qué recibe cada inscrito</h2>
      <p className="muted" style={{ marginTop: -8, marginBottom: 18 }}>
        El recorrido completo de una persona desde que se inscribe hasta que termina el curso.
      </p>
      {courses.map((course) => {
        const problemas = course.steps.filter((step) => step.blockedReason).length;
        return (
          <details className="course-comms" key={course.id} open={problemas > 0}>
            <summary>
              <span className="course-comms-title">
                <strong>{course.title}</strong>
                <small>
                  {course.enrollments} inscrito{course.enrollments === 1 ? "" : "s"}
                  {course.nextSessionAt ? ` · próxima sesión ${formatMoment(course.nextSessionAt)}` : " · sin fecha"}
                </small>
              </span>
              {problemas > 0
                ? <span className="status-dot is-attention">{problemas} sin poder salir</span>
                : <span className="status-dot is-done">Todo listo</span>}
            </summary>
            <div className="course-comms-body">
              <CourseTimeline
                hasSchedule={course.hasSchedule}
                steps={course.steps.map((step) => ({ ...step, scheduledAt: step.scheduledAt ? new Date(step.scheduledAt) : null }))}
              />
            </div>
          </details>
        );
      })}
    </section>
  );
}
