"use client";

import { useState } from "react";
import type { CourseCatalogReport } from "@/lib/course-catalog";
import { presentAdminValue } from "../adminPresentation";

export function CourseCatalogAudit({
  initialReport,
  canApply,
}: {
  initialReport: CourseCatalogReport;
  canApply: boolean;
}) {
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshReport() {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/courses/catalog", { cache: "no-store" });
    const result = await response.json();
    if (response.ok) setReport(result);
    setMessage(response.ok ? "Comparación actualizada." : result.error ?? "No se pudo comparar el catálogo.");
    setBusy(false);
  }

  async function applyCatalog() {
    const total = report.summary.MISSING_IN_CRM + report.summary.DIFFERENT + report.summary.EXTRA_IN_CRM;
    if (!window.confirm(`Se aplicarán ${total} cambios. Los cursos fuera del catálogo solo se desactivarán; nunca se borrarán. ¿Continuar?`)) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/admin/courses/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORTAR_CATALOGO_OFICIAL" }),
    });
    const result = await response.json();
    if (response.ok) setReport(result.report);
    setMessage(response.ok ? "Catálogo importado y comparado nuevamente." : result.error ?? "No se pudo importar el catálogo.");
    setBusy(false);
  }

  const pending = report.summary.MISSING_IN_CRM + report.summary.DIFFERENT + report.summary.EXTRA_IN_CRM;
  return (
    <section className="panel" aria-labelledby="catalog-audit-title">
      <div className="panel-header">
        <div className="panel-heading">
          <div>
            <h2 id="catalog-audit-title">Comparación con el catálogo oficial</h2>
            <p>Fuente: ra-training.com · Los registros históricos se conservan desactivados.</p>
          </div>
        </div>
        <div className="card-actions">
          <button className="btn-sm ghost" type="button" disabled={busy} onClick={refreshReport}>Actualizar comparación</button>
          {canApply && pending > 0 ? <button className="btn-sm" type="button" disabled={busy} onClick={applyCatalog}>Importar catálogo</button> : null}
        </div>
      </div>
      <div className="toolbar">
        <span className="pill ok">Coincidentes: {report.summary.MATCH}</span>
        <span className="pill warn">Faltantes: {report.summary.MISSING_IN_CRM}</span>
        <span className="pill warn">Distintos: {report.summary.DIFFERENT}</span>
        <span className="pill info">Históricos/sobrantes: {report.summary.EXTRA_IN_CRM}</span>
      </div>
      {message ? <p className="result-line" role="status">{message}</p> : null}
      {pending > 0 ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Curso</th><th>Estado</th><th>Diferencias</th><th>Relaciones CRM</th></tr></thead>
            <tbody>{report.differences.filter((item) => item.status !== "MATCH").map((item) => {
              const relations = item.crm?.relations;
              return (
                <tr key={`${item.status}:${item.slug}`}>
                  <td><strong>{item.official?.title ?? item.crm?.title}</strong><div className="muted">{item.slug}</div></td>
                  <td><span className="pill warn">{presentAdminValue(item.status)}</span></td>
                  <td>{item.fields.join(", ")}</td>
                  <td>{relations ? `${relations.interests} intereses · ${relations.enrollments} inscripciones · ${relations.followUps} seguimientos · ${relations.messages} mensajes · ${relations.audits} auditorías` : "Sin registro CRM"}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : <p className="form-success" role="status">El CRM coincide con el catálogo oficial normalizado.</p>}
    </section>
  );
}
