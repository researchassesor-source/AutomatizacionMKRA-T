"use client";

import { useEffect, useState } from "react";
import { AdminActionMenu } from "../AdminActionMenu";
import { TechnicalSection } from "../TechnicalDetail";
import { presentAdminValue, presentAuditAction, presentAuditArea, redactAuditMetadata } from "../adminPresentation";

export type AuditRow = { id: string; actorEmail: string | null; action: string; entityType: string; entityId: string | null; result: string; metadata: unknown; createdAt: string };

const shortDate = new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "short", timeZone: "America/Guayaquil" });
const fullDate = new Intl.DateTimeFormat("es-EC", { dateStyle: "full", timeStyle: "medium", timeZone: "America/Guayaquil" });
const formatDate = (formatter: Intl.DateTimeFormat, value: string) => formatter.format(new Date(value)).replace(/[\u00a0\u202f]/g, " ");

export function AuditLogTable({ logs, technical }: { logs: AuditRow[]; technical: boolean }) {
  const [pageSize, setPageSize] = useState(25);
  const [visibleCount, setVisibleCount] = useState(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const logSetKey = logs.map((log) => log.id).join("|");

  useEffect(() => { void logSetKey; setVisibleCount(pageSize); setSelectedId(null); }, [logSetKey, pageSize]);
  useEffect(() => {
    if (!selectedId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId]);
  const selected = logs.find((log) => log.id === selectedId) ?? null;
  const visibleLogs = logs.slice(0, visibleCount);

  return <>
    <fieldset className="table-presentation-toolbar"><legend className="sr-only">Controles de presentación</legend><span>Mostrando {Math.min(visibleCount, logs.length)} de {logs.length}</span><label>Filas por bloque<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value="25">25</option><option value="50">50</option></select></label></fieldset>
    <div className="table-wrap audit-table-wrap"><table className="data audit-human-table"><thead><tr><th>Fecha</th><th>Responsable</th><th>Área</th><th>Acción</th><th>Resultado</th><th>Entidad</th><th aria-label="Acciones" /></tr></thead><tbody>{visibleLogs.map((log) => <tr className="audit-table-row" key={log.id}>
      <td data-label="Fecha">{formatDate(shortDate, log.createdAt)}</td>
      <td data-label="Responsable">{log.actorEmail ?? "Sistema"}</td>
      <td data-label="Área">{presentAuditArea(log.action, log.entityType)}</td>
      <td data-label="Acción"><strong className="row-title">{presentAuditAction(log.action)}</strong></td>
      <td data-label="Resultado"><span className={`pill ${log.result === "SUCCESS" ? "ok" : "warn"}`}>{log.result === "SUCCESS" ? "Correcto" : "Requiere revisión"}</span></td>
      <td data-label="Entidad">{presentAdminValue(log.entityType)}</td>
      <td className="row-actions-cell"><AdminActionMenu label="Acciones del evento"><button type="button" onClick={() => setSelectedId(log.id)}>Ver evento</button></AdminActionMenu></td>
    </tr>)}</tbody></table></div>
    {visibleCount < logs.length ? <div className="table-more"><button type="button" className="btn-sm ghost" onClick={() => setVisibleCount((count) => count + pageSize)}>Mostrar {Math.min(pageSize, logs.length - visibleCount)} más</button></div> : null}

    {selected ? <div className="dialog-backdrop audit-detail-backdrop" role="presentation"><section className="dialog is-wide audit-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-detail-title"><header><div><span className="eyebrow">Evento de auditoría</span><h2 id="audit-detail-title">{presentAuditAction(selected.action)}</h2></div><button type="button" className="admin-dialog-close" aria-label="Cerrar evento" onClick={() => setSelectedId(null)}>×</button></header><dl className="detail-list"><dt>Responsable</dt><dd>{selected.actorEmail ?? "Sistema"}</dd><dt>Área</dt><dd>{presentAuditArea(selected.action, selected.entityType)}</dd><dt>Fecha</dt><dd>{formatDate(fullDate, selected.createdAt)}</dd><dt>Entidad</dt><dd>{presentAdminValue(selected.entityType)}</dd><dt>Resultado</dt><dd>{selected.result === "SUCCESS" ? "Correcto" : "Requiere revisión"}</dd></dl><TechnicalSection visible={technical}><details className="technical-context"><summary>Ver detalle técnico</summary><dl className="detail-list"><dt>Acción interna</dt><dd>{selected.action}</dd><dt>Identificador del evento</dt><dd>{selected.id}</dd><dt>Referencia de entidad</dt><dd>{selected.entityId ?? "—"}</dd></dl><details className="technical-json"><summary>Ver metadatos depurados</summary><pre className="audit-metadata">{selected.metadata ? JSON.stringify(redactAuditMetadata(selected.metadata), null, 2) : "Sin metadatos"}</pre></details></details></TechnicalSection></section></div> : null}
  </>;
}
