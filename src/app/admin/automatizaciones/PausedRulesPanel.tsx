"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAUSE_REASON_LABELS, type PauseDiagnosisReport, type PauseReason } from "@/lib/automation-pause-diagnostics";
import { presentAdminValue } from "../adminPresentation";

/**
 * Desglose de automatizaciones pausadas por curso y motivo.
 *
 * Existe porque una sincronización llegó a pausar reglas de cursos vigentes sin
 * dejar constancia por regla: sin este desglose no hay forma de distinguir una
 * pausa correcta de un error.
 */
export function PausedRulesPanel({ canRecover }: { canRecover: boolean }) {
  const router = useRouter();
  const [report, setReport] = useState<PauseDiagnosisReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (busy) return;
    setBusy("load");
    setMessage("Consultando automatizaciones pausadas…");
    const response = await fetch("/api/admin/automations/paused");
    const data = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok || !data) {
      setMessage("No se pudo obtener el diagnóstico.");
      return;
    }
    setReport(data as PauseDiagnosisReport);
    setMessage(null);
  }

  async function recover(courseId?: string) {
    if (busy) return;
    const scope = courseId ? "de este curso" : "de todos los cursos vigentes";
    if (!window.confirm(`¿Reactivar las automatizaciones ${scope} que se pausaron por error? Solo se tocan las que hoy vuelven a ser ejecutables; las pausadas por un motivo válido se conservan.`)) return;
    setBusy(courseId ?? "recover-all");
    setMessage("Reactivando y reprogramando…");
    const response = await fetch("/api/admin/automations/paused", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, courseId, reschedule: true }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(response.ok ? String(data.message ?? "Recuperación completada.") : String(data.error ?? "No se pudo recuperar."));
    if (response.ok) {
      await load();
      router.refresh();
    }
  }

  return (
    <section className="panel">
      <h2>Automatizaciones pausadas</h2>
      <p className="muted">
        Consulta por curso y motivo qué reglas están pausadas. Cerrar inscripciones nuevas ya no pausa nada;
        si una regla aparece como recuperable es porque se pausó por error.
      </p>
      <div className="card-actions">
        <button type="button" className="btn-sm" disabled={busy !== null} onClick={load}>
          {busy === "load" ? "Consultando…" : "Ver desglose"}
        </button>
        {canRecover && report && report.recoverableRules > 0 && (
          <button type="button" className="btn-sm" disabled={busy !== null} onClick={() => recover()}>
            {busy === "recover-all" ? "Reactivando…" : `Reactivar ${report.recoverableRules} pausadas por error`}
          </button>
        )}
      </div>
      {message && <p className="result-line" role="status">{message}</p>}

      {report && (
        <>
          <p className="muted">
            Pausadas: {report.pausedRules} · Recuperables: {report.recoverableRules}
            {report.lastSyncPauseAt && ` · Última pausa por sincronización: ${new Date(report.lastSyncPauseAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}`}
          </p>
          {report.courses.length === 0 ? (
            <p className="muted">No hay automatizaciones pausadas.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Curso</th><th>Estado del curso</th><th>Reglas pausadas</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {report.courses.map((course) => (
                    <tr key={course.courseId}>
                      <td>
                        <strong>{course.title}</strong>
                        <div className="muted">{course.slug}{course.externalId ? ` · WordPress ${course.externalId}` : ""}</div>
                        <div className="muted">{course.enrollments} inscripciones · {course.sessions} sesiones</div>
                      </td>
                      <td>
                        <span className={`pill ${course.isPublished ? "ok" : "warn"}`}>{course.isPublished ? "Publicado" : "Despublicado"}</span>
                        <div className="muted">Inscripciones nuevas: {course.acceptsRegistrations ? "abiertas" : "cerradas"}</div>
                        <div className="muted">Catálogo: {presentAdminValue(course.syncStatus)}</div>
                        <div className="muted">{course.hasSchedule ? "Con calendario" : "Sin fecha ni sesiones"}</div>
                      </td>
                      <td>
                        <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                          {course.rules.map((rule) => (
                            <li key={rule.ruleId}>
                              <strong>{rule.ruleName}</strong>
                              <div className="muted">{presentAdminValue(rule.channel)} · {presentAdminValue(rule.trigger)}</div>
                              <div className="muted">{PAUSE_REASON_LABELS[rule.reason as PauseReason]}</div>
                              <div className="muted">Modificada: {new Date(rule.updatedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</div>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        {canRecover && course.recoverableRules > 0 ? (
                          <button type="button" className="btn-sm" disabled={busy !== null} onClick={() => recover(course.courseId)}>
                            {busy === course.courseId ? "Reactivando…" : `Reactivar ${course.recoverableRules}`}
                          </button>
                        ) : (
                          <span className="muted">Sin reglas recuperables</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
