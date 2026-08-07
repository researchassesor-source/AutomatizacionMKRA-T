"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../../Feedback";
import { ScheduleSessionButton } from "../ScheduleSessionButton";
import { ImportScheduleButton } from "../ImportScheduleButton";
import { formatDay, formatTime } from "@/lib/message-presentation";

type SessionRow = { id: string; title: string | null; startAt: string; endAt: string | null; streamUrl: string | null };

/**
 * Calendario operativo del curso.
 *
 * La fecha es lo que hace posible calcular los recordatorios; el enlace puede
 * llegar despues. El panel distingue las dos cosas en vez de tratarlas como un
 * unico "falta configurar".
 */
export function CourseSessionsPanel({
  courseId,
  courseTitle,
  enrollments,
  modality,
  canEdit,
  sessions,
}: {
  courseId: string;
  courseTitle: string;
  enrollments: number;
  modality: string | null;
  canEdit: boolean;
  sessions: SessionRow[];
}) {
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function saveLink(sessionId: string, streamUrl: string) {
    setBusy(sessionId);
    const response = await fetch(`/api/admin/courses/${courseId}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamUrl: streamUrl.trim() || null }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      toast({ tone: "error", title: "No se pudo guardar el enlace", detail: result.error ?? "Inténtalo de nuevo." });
      return;
    }
    setEditing(null);
    toast({
      tone: "success",
      title: streamUrl.trim() ? "Enlace guardado" : "Enlace eliminado",
      detail: streamUrl.trim()
        ? "Los recordatorios de acceso ya pueden salir para esta sesión."
        : "Los recordatorios de acceso quedarán en espera hasta que agregues uno.",
    });
    router.refresh();
  }

  async function remove(sessionRow: SessionRow) {
    const ok = await confirm({
      title: "Eliminar esta sesión",
      body: `Se cancelarán los recordatorios pendientes de ${formatDay(sessionRow.startAt)} · ${formatTime(sessionRow.startAt)}. Los mensajes ya enviados se conservan.`,
      confirmLabel: "Eliminar sesión",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(sessionRow.id);
    const response = await fetch(`/api/admin/courses/${courseId}/sessions/${sessionRow.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok) {
      toast({ tone: "error", title: "No se pudo eliminar la sesión", detail: result.error ?? "Inténtalo de nuevo." });
      return;
    }
    toast({ tone: "success", title: "Sesión eliminada", detail: "Los recordatorios pendientes se cancelaron." });
    router.refresh();
  }

  return (
    <section className="panel">
      <div className="panel-head panel-head-actions">
        <h2>Calendario</h2>
        {canEdit && sessions.length === 0 ? (
          <ImportScheduleButton courseId={courseId} enrollments={enrollments} />
        ) : null}
        {canEdit ? (
          <ScheduleSessionButton
            courseId={courseId}
            courseTitle={courseTitle}
            enrollments={enrollments}
            modality={modality}
            label={sessions.length === 0 ? "Programar sesión" : "Añadir sesión"}
            variant={sessions.length === 0 ? "primary" : "ghost"}
          />
        ) : null}
      </div>

      {sessions.length === 0 ? (
        <div className="home-empty">
          <p><strong>Este curso todavía no tiene ninguna sesión.</strong></p>
          <p>
            La fecha y la hora son lo que permite calcular los cinco avisos automáticos.
            {enrollments > 0 ? ` Hay ${enrollments} ${enrollments === 1 ? "persona inscrita esperando" : "personas inscritas esperando"}.` : ""}
          </p>
        </div>
      ) : (
        <div className="session-rows">
          {sessions.map((sessionRow) => (
            <article className="session-row" key={sessionRow.id}>
              <div className="session-row-main">
                <strong>{sessionRow.title?.trim() || "Sesión"}</strong>
                <span className="session-when">{formatDay(sessionRow.startAt)} · {formatTime(sessionRow.startAt)}</span>
                {sessionRow.endAt ? <small>Termina a las {formatTime(sessionRow.endAt)}</small> : null}
              </div>

              <div className="session-row-link">
                {editing === sessionRow.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveLink(sessionRow.id, String(new FormData(event.currentTarget).get("streamUrl") ?? ""));
                    }}
                  >
                    <input name="streamUrl" type="url" defaultValue={sessionRow.streamUrl ?? ""} placeholder="https://meet.google.com/…" />
                    <button type="submit" className="btn-sm" disabled={busy === sessionRow.id}>{busy === sessionRow.id ? "Guardando…" : "Guardar"}</button>
                    <button type="button" className="btn-sm ghost" onClick={() => setEditing(null)}>Cancelar</button>
                  </form>
                ) : sessionRow.streamUrl ? (
                  <>
                    <span className="status-dot is-done">Enlace listo</span>
                    {canEdit ? <button type="button" className="btn-sm ghost" onClick={() => setEditing(sessionRow.id)}>Cambiar</button> : null}
                  </>
                ) : (
                  <>
                    <span className="status-dot is-attention">Enlace de acceso pendiente</span>
                    {canEdit ? <button type="button" className="btn-sm" onClick={() => setEditing(sessionRow.id)}>Agregar enlace</button> : null}
                  </>
                )}
              </div>

              {canEdit && editing !== sessionRow.id ? (
                <button type="button" className="btn-sm ghost danger" onClick={() => remove(sessionRow)} disabled={busy === sessionRow.id}>
                  Eliminar
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
