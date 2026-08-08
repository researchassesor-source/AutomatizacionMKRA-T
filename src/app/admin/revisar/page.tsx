import Link from "next/link";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { loadDashboard } from "@/lib/dashboard";
import { AdminIcon } from "../AdminIcon";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { ImportScheduleButton } from "../cursos/ImportScheduleButton";
import { ScheduleSessionButton } from "../cursos/ScheduleSessionButton";

export const dynamic = "force-dynamic";

/**
 * Lo que necesita atencion, en su propio sitio.
 *
 * Vivia al final del Inicio y antes al principio; ninguno de los dos sitios
 * era el correcto. Entrar a trabajar no deberia empezar por una lista de
 * problemas, pero esa lista tampoco debe esconderse: tiene su destino en la
 * navegacion y el Inicio solo lleva la cuenta.
 */
export default async function RevisarPage() {
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  const data = await loadDashboard();

  return (
    <main className="container admin-shell">
      <AdminNav view={view} />
      <AdminPageHeader
        eyebrow="Pendientes"
        title="Revisar"
        description="Lo que impide que algo salga o que ya falló. Cada punto lleva al sitio donde se resuelve."
      />

      {data.attention.length === 0 ? (
        <div className="attention-empty">
          <AdminIcon name="secure" size={18} />
          <span><strong>Todo al día.</strong> No hay nada pendiente de revisar.</span>
        </div>
      ) : (
        <div className="attention-list">
          {data.attention.map((item) => (
            <article className={`attention-item ${item.severity === "error" ? "is-error" : ""}`} key={item.id}>
              <div className="attention-copy">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </div>
              {item.scheduleCourse ? (
                <ImportScheduleButton courseId={item.scheduleCourse.id} enrollments={item.scheduleCourse.enrollments} />
              ) : null}
              {item.scheduleCourse ? (
                <ScheduleSessionButton
                  courseId={item.scheduleCourse.id}
                  courseTitle={item.scheduleCourse.title}
                  enrollments={item.scheduleCourse.enrollments}
                  modality={item.scheduleCourse.modality}
                  label={item.actionLabel}
                />
              ) : (
                <Link className="btn-sm" href={item.href}>{item.actionLabel}</Link>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
