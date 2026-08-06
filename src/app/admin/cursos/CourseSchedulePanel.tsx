"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ecuadorLocalDateTimeToIso, isoToEcuadorLocalInput } from "@/lib/time";
import { AdminEmptyState } from "../AdminEmptyState";

export type SessionRow = {
  id: string;
  title: string | null;
  startAt: string;
  endAt: string | null;
  streamUrl: string | null;
};

export type ScheduledCourse = {
  id: string;
  slug: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  streamUrl: string | null;
  enrollments: number;
  automations: number;
  sessions: SessionRow[];
};

const formatter = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });

async function request(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, data: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

/**
 * Sesiones, enlace de transmisión y enlace de inscripción por curso.
 *
 * Un curso puede tener varias fechas y reutilizar el mismo enlace entre ellas.
 * Si no se registra ninguna sesión, el CRM sigue usando la fecha general del
 * curso como sesión única.
 */
export function CourseSchedulePanel({ courses, canEdit, publicOrigin }: { courses: ScheduledCourse[]; canEdit: boolean; publicOrigin: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<{ ok: boolean; data: Record<string, unknown> }>, success: string) {
    setBusy(key);
    const result = await action();
    setBusy(null);
    setMessage(result.ok ? success : String(result.data.error ?? "No se pudo completar la acción."));
    if (result.ok) router.refresh();
    return result;
  }

  async function saveStreamUrl(event: React.FormEvent<HTMLFormElement>, course: ScheduledCourse) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await run(
      `stream-${course.id}`,
      () => request(`/api/admin/courses/${course.id}/sessions`, "PATCH", { streamUrl: String(data.get("streamUrl") ?? "") }),
      "Enlace de transmisión actualizado y recordatorios recalculados.",
    );
  }

  async function createSession(event: React.FormEvent<HTMLFormElement>, course: ScheduledCourse) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const startLocal = String(data.get("startAt") ?? "");
    const endLocal = String(data.get("endAt") ?? "");
    if (!startLocal) {
      setMessage("Indica la fecha y hora de inicio de la sesión.");
      return;
    }
    const result = await run(
      `session-new-${course.id}`,
      () => request(`/api/admin/courses/${course.id}/sessions`, "POST", {
        title: String(data.get("title") ?? ""),
        startAt: ecuadorLocalDateTimeToIso(startLocal),
        endAt: endLocal ? ecuadorLocalDateTimeToIso(endLocal) : "",
        streamUrl: String(data.get("streamUrl") ?? ""),
      }),
      "Sesión creada y recordatorios programados.",
    );
    if (result.ok) form.reset();
  }

  async function updateSession(event: React.FormEvent<HTMLFormElement>, course: ScheduledCourse, session: SessionRow) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startLocal = String(data.get("startAt") ?? "");
    const endLocal = String(data.get("endAt") ?? "");
    if (!startLocal) {
      setMessage("Indica la fecha y hora de inicio de la sesión.");
      return;
    }
    await run(
      `session-${session.id}`,
      () => request(`/api/admin/courses/${course.id}/sessions/${session.id}`, "PATCH", {
        title: String(data.get("title") ?? ""),
        startAt: ecuadorLocalDateTimeToIso(startLocal),
        endAt: endLocal ? ecuadorLocalDateTimeToIso(endLocal) : "",
        streamUrl: String(data.get("streamUrl") ?? ""),
      }),
      "Sesión actualizada y recordatorios recalculados.",
    );
  }

  async function deleteSession(course: ScheduledCourse, session: SessionRow) {
    if (!window.confirm("¿Eliminar esta sesión? Se cancelarán sus recordatorios pendientes y se conservará el historial de lo ya enviado.")) return;
    await run(
      `session-${session.id}`,
      () => request(`/api/admin/courses/${course.id}/sessions/${session.id}`, "DELETE", { confirm: true }),
      "Sesión eliminada; el historial de mensajes se conservó.",
    );
  }

  async function copyEnrollmentLink(course: ScheduledCourse) {
    const url = `${publicOrigin}/cursos/${course.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Enlace de inscripción copiado: ${url}`);
    } catch {
      setMessage(`Copia manualmente este enlace: ${url}`);
    }
  }

  return (
    <section className="panel">
      <h2>Sesiones y enlaces de transmisión</h2>
      <p className="muted">
        Cada sesión genera sus propios recordatorios (24 horas, 2 horas y 15 minutos antes). El agradecimiento se envía después de la última sesión.
        Si un curso no tiene sesiones registradas, se usa su fecha general como sesión única.
      </p>
      {message && <p className="result-line" role="status">{message}</p>}
      {courses.length === 0 ? (
        <AdminEmptyState icon="courses" title="No hay cursos para programar" description="Crea o publica un curso para configurar sus sesiones." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Curso</th><th>Calendario</th><th>Enlace de transmisión</th><th>Inscritos</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <td>
                    <strong>{course.title}</strong>
                    <div className="muted">{course.slug}</div>
                    <div className="muted">{course.automations} automatizaciones configuradas</div>
                  </td>
                  <td>
                    {course.sessions.length === 0 ? (
                      <div className="muted">
                        {course.startsAt
                          ? `Sesión única: ${formatter.format(new Date(course.startsAt))}`
                          : "Sin fecha configurada. Los recordatorios no se programan."}
                      </div>
                    ) : (
                      <ol className="muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                        {course.sessions.map((session) => (
                          <li key={session.id}>
                            {session.title ? `${session.title} · ` : ""}
                            {formatter.format(new Date(session.startAt))}
                            {session.streamUrl ? "" : " · sin enlace propio"}
                          </li>
                        ))}
                      </ol>
                    )}
                  </td>
                  <td>
                    {course.streamUrl ? <span className="pill ok">Configurado</span> : <span className="pill warn">Sin enlace</span>}
                    <div className="muted">{course.streamUrl ?? "El recordatorio de 15 minutos quedará omitido hasta configurarlo."}</div>
                  </td>
                  <td>{course.enrollments}</td>
                  <td>
                    <div className="card-actions">
                      <button type="button" className="btn-sm ghost" onClick={() => copyEnrollmentLink(course)}>Copiar enlace de inscripción</button>
                      {canEdit && (
                        <button type="button" className="btn-sm ghost" onClick={() => setExpanded(expanded === course.id ? null : course.id)}>
                          {expanded === course.id ? "Cerrar" : "Configurar sesiones"}
                        </button>
                      )}
                    </div>
                    {canEdit && expanded === course.id && (
                      <div className="stacked-forms">
                        <form onSubmit={(event) => saveStreamUrl(event, course)}>
                          <label className="field">
                            <span>Enlace de transmisión del curso</span>
                            <input name="streamUrl" type="url" defaultValue={course.streamUrl ?? ""} placeholder="https://..." />
                          </label>
                          <button type="submit" className="btn-sm" disabled={busy === `stream-${course.id}`}>Guardar enlace</button>
                        </form>

                        {course.sessions.map((session) => (
                          <form key={session.id} onSubmit={(event) => updateSession(event, course, session)}>
                            <div className="form-row">
                              <input name="title" defaultValue={session.title ?? ""} placeholder="Nombre de la sesión (opcional)" />
                              <input name="startAt" type="datetime-local" defaultValue={isoToEcuadorLocalInput(session.startAt)} required aria-label="Inicio de la sesión" />
                              <input name="endAt" type="datetime-local" defaultValue={session.endAt ? isoToEcuadorLocalInput(session.endAt) : ""} aria-label="Cierre de la sesión" />
                            </div>
                            <div className="form-row">
                              <input name="streamUrl" type="url" defaultValue={session.streamUrl ?? ""} placeholder="Enlace propio (opcional)" />
                              <button type="submit" className="btn-sm" disabled={busy === `session-${session.id}`}>Guardar sesión</button>
                              <button type="button" className="btn-sm danger" disabled={busy === `session-${session.id}`} onClick={() => deleteSession(course, session)}>Eliminar sesión</button>
                            </div>
                          </form>
                        ))}

                        <form onSubmit={(event) => createSession(event, course)}>
                          <div className="form-row">
                            <input name="title" placeholder="Nombre de la nueva sesión (opcional)" />
                            <input name="startAt" type="datetime-local" required aria-label="Inicio de la nueva sesión" />
                            <input name="endAt" type="datetime-local" aria-label="Cierre de la nueva sesión" />
                          </div>
                          <div className="form-row">
                            <input name="streamUrl" type="url" placeholder="Enlace propio (opcional)" />
                            <button type="submit" className="btn-sm" disabled={busy === `session-new-${course.id}`}>Agregar sesión</button>
                          </div>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
