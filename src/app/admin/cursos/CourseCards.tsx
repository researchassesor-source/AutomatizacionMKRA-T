import Link from "next/link";
import { formatDay, formatTime } from "@/lib/message-presentation";
import { ScheduleSessionButton } from "./ScheduleSessionButton";
import { ImportScheduleButton } from "./ImportScheduleButton";

export type CourseCard = {
  id: string;
  title: string;
  modality: string | null;
  enrollments: number;
  nextSessionAt: string | null;
  hasStreamUrl: boolean;
  sessionsCount: number;
  isPublished: boolean;
};

/**
 * Tarjeta por curso.
 *
 * El estado de preparacion es lo unico que hace falta leer: dice si el curso
 * puede operar y, si no, que le falta y donde se arregla. Un curso sin fecha no
 * dice "por definir" sino "sesion pendiente de programar", que es una frase con
 * sujeto y con salida.
 */
export function CourseCards({ courses, canEdit }: { courses: CourseCard[]; canEdit: boolean }) {
  return (
    <div className="course-cards">
      {courses.map((course) => {
        const sinFecha = course.sessionsCount === 0;
        const estado = sinFecha
          ? { tone: "is-attention", text: "Requiere configuración: sesión" }
          : course.hasStreamUrl
            ? { tone: "is-done", text: "Listo" }
            : { tone: "is-attention", text: "Requiere configuración: enlace" };

        return (
          <article className="course-card-row" id={`curso-${course.id}`} key={course.id}>
            <div className="course-card-main">
              <Link href={`/admin/cursos/${course.id}`} className="course-card-title">{course.title}</Link>
              <div className="course-card-meta">
                <span className={`pill ${course.isPublished ? "ok" : ""}`}>{course.isPublished ? "Publicado" : "No publicado"}</span>
                {course.modality ? <span>{course.modality}</span> : null}
                <span>{course.enrollments} inscrito{course.enrollments === 1 ? "" : "s"}</span>
                {course.nextSessionAt
                  ? <span className="course-card-date">{formatDay(course.nextSessionAt)} · {formatTime(course.nextSessionAt)}</span>
                  : null}
              </div>
            </div>

            <span className={`status-dot ${estado.tone}`}>{estado.text}</span>

            <div className="course-card-actions">
              {sinFecha && canEdit ? (
                <ImportScheduleButton courseId={course.id} enrollments={course.enrollments} />
              ) : null}
              {sinFecha && canEdit ? (
                <ScheduleSessionButton
                  courseId={course.id}
                  courseTitle={course.title}
                  enrollments={course.enrollments}
                  modality={course.modality}
                />
              ) : null}
              <Link className="btn-sm ghost" href={`/admin/cursos/${course.id}`}>Ver curso</Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
