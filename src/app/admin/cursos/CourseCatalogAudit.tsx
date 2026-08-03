"use client";

import { useRef, useState } from "react";
import type { CourseCatalogReport } from "@/lib/course-catalog";
import { presentAdminValue } from "../adminPresentation";

type OperationState = "idle" | "loading" | "importing" | "success" | "partial" | "error" | "no-changes";

const statusClass = {
  MATCH: "ok",
  MISSING_IN_CRM: "warn",
  DIFFERENT: "catalog-different",
  EXTRA_IN_CRM: "catalog-historical",
} as const;

export function CourseCatalogAudit({
  initialReport,
  canApply,
}: {
  initialReport: CourseCatalogReport;
  canApply: boolean;
}) {
  const [report, setReport] = useState(initialReport);
  const [operation, setOperation] = useState<OperationState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const busy = operation === "loading" || operation === "importing";
  const pending = report.actions.create + report.actions.update + report.actions.deactivate;
  const visibleDifferences = report.differences.filter((item) => item.status !== "MATCH");

  async function refreshReport() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOperation("loading");
    setMessage("Cargando comparación…");
    try {
      const response = await fetch("/api/admin/courses/catalog", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo comparar el catálogo.");
      setReport(result);
      const changes = result.actions.create + result.actions.update + result.actions.deactivate;
      setOperation(changes === 0 ? "no-changes" : "success");
      setMessage(changes === 0 ? "Comparación actualizada: no hay cambios pendientes." : "Comparación actualizada.");
    } catch (error) {
      setOperation("error");
      setMessage(error instanceof Error ? error.message : "No se pudo comparar el catálogo.");
    } finally {
      inFlight.current = false;
    }
  }

  async function applyCatalog() {
    if (inFlight.current || !canApply || pending === 0) return;
    const confirmation = [
      `Se crearán ${report.actions.create} cursos oficiales en el CRM. Los cursos históricos se conservarán, pero dejarán de mostrarse como oferta vigente.`,
      "",
      `${report.actions.create} cursos por crear`,
      `${report.actions.update} cursos por actualizar`,
      `${report.actions.deactivate} cursos históricos por desactivar`,
      `${report.actions.delete} registros por eliminar`,
    ].join("\n");
    if (!window.confirm(confirmation)) return;

    inFlight.current = true;
    setOperation("importing");
    setMessage("Importando el catálogo oficial…");
    try {
      const response = await fetch("/api/admin/courses/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "IMPORTAR_CATALOGO_OFICIAL" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo importar el catálogo.");
      setReport(result.report);
      const remaining = result.report.actions.create + result.report.actions.update + result.report.actions.deactivate;
      if (remaining > 0) {
        setOperation("partial");
        setMessage(`Importación parcial: quedan ${remaining} cambios pendientes. Actualiza la comparación antes de reintentar.`);
      } else if (result.changes.created === 0 && result.changes.updated === 0 && result.changes.deactivated === 0) {
        setOperation("no-changes");
        setMessage("El catálogo ya estaba actualizado; no se crearon duplicados ni se modificaron registros.");
      } else {
        setOperation("success");
        setMessage(`Catálogo importado correctamente: ${result.changes.created} cursos creados y ${result.changes.deactivated} cursos históricos desactivados.`);
      }
    } catch (error) {
      setOperation("error");
      setMessage(error instanceof Error ? error.message : "No se pudo importar el catálogo.");
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <section className="panel" aria-labelledby="catalog-audit-title" aria-busy={busy}>
      <div className="panel-header">
        <div className="panel-heading">
          <div>
            <h2 id="catalog-audit-title">Comparación con referencia local</h2>
            <p>Datos versionados en el repositorio; no es una lectura en vivo de WordPress. Los registros históricos se conservan.</p>
          </div>
        </div>
        <div className="card-actions">
          <button className="btn-sm ghost" type="button" disabled={busy} onClick={refreshReport}>
            {operation === "loading" ? "Actualizando…" : "Actualizar comparación"}
          </button>
          {pending > 0 ? (
            <button className="btn-sm" type="button" disabled={busy || !canApply} onClick={applyCatalog}>
              {operation === "importing" ? "Aplicando…" : "Aplicar referencia local"}
            </button>
          ) : null}
        </div>
      </div>

      <section className="toolbar catalog-summary" aria-label="Resumen de comparación">
        <span className="pill ok">Coincidentes: {report.summary.MATCH}</span>
        <span className="pill warn">Faltantes: {report.summary.MISSING_IN_CRM}</span>
        <span className="pill catalog-different">Distintos: {report.summary.DIFFERENT}</span>
        <span className="pill catalog-historical">Históricos/sobrantes: {report.summary.EXTRA_IN_CRM}</span>
      </section>

      <div className="catalog-explanations">
        <p><strong>Falta en el CRM:</strong> el curso existe en el catálogo oficial, pero todavía no está registrado en la base del CRM.</p>
        <p><strong>Histórico o sobrante:</strong> el curso existe en el CRM, pero ya no forma parte del catálogo oficial vigente. Se conserva por su historial.</p>
      </div>

      {!canApply ? <p className="admin-notice" role="status">Operación bloqueada en Producción. La comparación permanece disponible en modo de lectura.</p> : null}
      {message ? <p className={operation === "error" ? "form-error" : operation === "partial" ? "admin-notice" : "result-line"} role={operation === "error" ? "alert" : "status"}>{message}</p> : null}

      <section className="catalog-change-summary" aria-label="Cambios propuestos">
        <span>{report.actions.create} por crear</span>
        <span>{report.actions.update} por actualizar</span>
        <span>{report.actions.deactivate} históricos por desactivar</span>
        <span>{report.actions.delete} por eliminar</span>
      </section>

      {visibleDifferences.length > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Curso</th><th>Estado</th><th>Diferencias</th><th>Relaciones CRM</th></tr></thead>
            <tbody>{visibleDifferences.map((item) => {
              const relations = item.crm?.relations;
              return (
                <tr key={`${item.status}:${item.slug}`}>
                  <td><strong>{item.official?.title ?? item.crm?.title}</strong><div className="muted">{item.slug}</div></td>
                  <td><span className={`pill ${statusClass[item.status]}`}>{presentAdminValue(item.status)}</span></td>
                  <td>{item.fields.join(", ")}</td>
                  <td>{relations ? `${relations.interests} intereses · ${relations.enrollments} inscripciones · ${relations.followUps} seguimientos · ${relations.messages} mensajes · ${relations.financeHandoffs} Finance · ${relations.moodleCompletions} Moodle · ${relations.audits} auditorías` : "Sin registro CRM"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <p className="form-success" role="status">El CRM coincide con el catálogo oficial normalizado.</p>}
    </section>
  );
}
