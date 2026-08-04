"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ConflictItem = { externalId: string; officialSlug: string; title: string; reason: string };
export type SyncMetadata = {
  unchanged?: number;
  current?: number;
  open?: number;
  closed?: number;
  historical?: number;
  activeRules?: number;
  pausedRules?: number;
  rulesPausedThisRun?: number;
  conflictItems?: ConflictItem[];
};
type SyncRun = {
  id: string;
  status: string;
  discovered: number;
  created: number;
  updated: number;
  conflicts: number;
  errors: number;
  error: string | null;
  metadata: SyncMetadata | null;
  startedAt: string;
  completedAt: string | null;
};
export type SyncedCourseRow = {
  id: string;
  slug: string;
  title: string;
  externalId: string | null;
  externalSource: string | null;
  officialUrl: string | null;
  syncStatus: string;
  syncError: string | null;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  lastSyncedAt: string | null;
};

type CatalogTab = "current" | "issues" | "historical";

const conflictReason: Record<string, string> = {
  PLACEHOLDER_WITHOUT_EXPLICIT_MAPPING: "Página “Próximamente” sin curso inequívoco en el CRM.",
  CRM_SLUG_AMBIGUOUS: "El identificador CRM coincide con más de un registro.",
  OFFICIAL_SLUG_AMBIGUOUS: "El identificador oficial coincide con más de un registro.",
  COURSE_LINKED_TO_ANOTHER_SOURCE: "El curso ya pertenece a otra fuente externa.",
  COURSE_ALREADY_LINKED_TO_ANOTHER_WORDPRESS_ID: "El curso ya está vinculado a otro ID de WordPress.",
  INVALID_EXPLICIT_CRM_SLUG: "El identificador CRM explícito no es válido.",
  INVALID_OFFICIAL_SLUG: "El identificador oficial no se puede usar de forma segura.",
};

function CourseTable({ courses, empty }: { courses: SyncedCourseRow[]; empty: string }) {
  if (!courses.length) return <p className="muted">{empty}</p>;
  return <div className="table-wrap"><table className="data course-sync-table"><thead><tr><th>Curso</th><th>Identidad WordPress</th><th>Estado</th><th>Última sincronización</th></tr></thead><tbody>{courses.map((course) => (
    <tr key={course.id}>
      <td><strong>{course.title}</strong><div className="muted">{course.slug}</div></td>
      <td>{course.externalId ? `ID ${course.externalId}` : "Sin ID externo"}<div className="muted">{course.externalSource ?? "Fuente no vinculada"}</div></td>
      <td><span className={`pill ${course.isPublished ? "ok" : "catalog-historical"}`}>{course.isPublished ? "Vigente" : "Histórico"}</span><div className="muted">{course.acceptsRegistrations ? "Registro abierto" : "Registro cerrado"}</div></td>
      <td>{course.lastSyncedAt ? new Date(course.lastSyncedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) : "Sin sincronizar"}</td>
    </tr>
  ))}</tbody></table></div>;
}

export function WordPressCatalogSync({ configured, latestRun, courses }: { configured: boolean; latestRun: SyncRun | null; courses: SyncedCourseRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<CatalogTab>("current");
  const metadata = latestRun?.metadata ?? {};
  const currentCourses = useMemo(() => courses.filter((course) => course.externalSource === "wordpress" && course.syncStatus !== "HISTORICAL"), [courses]);
  const historicalCourses = useMemo(() => courses.filter((course) => course.syncStatus === "HISTORICAL"), [courses]);
  const courseConflicts = useMemo(() => courses.filter((course) => course.syncStatus === "CONFLICT"), [courses]);
  const sourceConflicts = metadata.conflictItems ?? [];

  async function sync() {
    if (!window.confirm("Se consultará el catálogo público de WordPress mediante GET. Los cursos y relaciones históricas se conservarán; las automatizaciones no elegibles se pausarán. ¿Continuar?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/courses/catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "No se pudo sincronizar.");
      setMessage(`Sincronización terminada: ${result.created} nuevos, ${result.updated} actualizados, ${result.unchanged} sin cambios, ${result.conflicts} conflictos y ${result.errors} errores.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo sincronizar.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel" aria-labelledby="wordpress-sync-title" aria-busy={busy} data-testid="wordpress-course-sync">
    <div className="panel-header"><div><h2 id="wordpress-sync-title">Sincronización con WordPress</h2><p>Consulta en vivo del catálogo oficial de cursos publicado en WordPress. Los registros históricos y sus relaciones se conservan en el CRM.</p></div><button type="button" className="btn-sm" disabled={busy || !configured} onClick={sync}>{busy ? "Sincronizando…" : "Sincronizar desde WordPress"}</button></div>
    {!configured && <p className="admin-notice"><strong>Bloqueado:</strong> falta configurar el endpoint público de cursos de WordPress.</p>}
    <section className="toolbar catalog-summary" aria-label="Resumen de sincronización">
      <span className="pill info">Recibidos: {latestRun?.discovered ?? 0}</span>
      <span className="pill ok">Vigentes: {metadata.current ?? currentCourses.length}</span>
      <span className="pill ok">Registro abierto: {metadata.open ?? currentCourses.filter((course) => course.acceptsRegistrations).length}</span>
      <span className="pill warn">Registro cerrado: {metadata.closed ?? currentCourses.filter((course) => !course.acceptsRegistrations).length}</span>
      <span className="pill info">Nuevos: {latestRun?.created ?? 0}</span>
      <span className="pill info">Actualizados: {latestRun?.updated ?? 0}</span>
      <span className="pill info">Sin cambios: {metadata.unchanged ?? 0}</span>
      <span className="pill warn">Conflictos: {latestRun?.conflicts ?? sourceConflicts.length}</span>
      <span className="pill catalog-historical">Históricos: {metadata.historical ?? historicalCourses.length}</span>
      <span className="pill err">Errores: {latestRun?.errors ?? 0}</span>
    </section>
    {latestRun && <dl className="detail-list"><dt>Última sincronización</dt><dd>{new Date(latestRun.completedAt ?? latestRun.startedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</dd><dt>Estado</dt><dd>{latestRun.status}</dd><dt>Automatizaciones</dt><dd>{metadata.activeRules ?? 0} activas · {metadata.pausedRules ?? 0} pausadas{metadata.rulesPausedThisRun ? ` · ${metadata.rulesPausedThisRun} pausadas en esta ejecución` : ""}</dd>{latestRun.error && <><dt>Error controlado</dt><dd>{latestRun.error}</dd></>}</dl>}
    {message && <p className={message.startsWith("Sincronización terminada") ? "result-line form-success" : "form-error"} role="status">{message}</p>}
    <div className="toolbar segmented-tabs" role="tablist" aria-label="Estado del catálogo sincronizado">
      <button type="button" role="tab" aria-selected={tab === "current"} className={`btn-sm ${tab === "current" ? "" : "ghost"}`} onClick={() => setTab("current")}>Cursos vigentes ({currentCourses.length})</button>
      <button type="button" role="tab" aria-selected={tab === "issues"} className={`btn-sm ${tab === "issues" ? "" : "ghost"}`} onClick={() => setTab("issues")}>Diferencias o conflictos ({sourceConflicts.length + courseConflicts.length})</button>
      <button type="button" role="tab" aria-selected={tab === "historical"} className={`btn-sm ${tab === "historical" ? "" : "ghost"}`} onClick={() => setTab("historical")}>Cursos históricos ({historicalCourses.length})</button>
    </div>
    {tab === "current" && <CourseTable courses={currentCourses} empty="Aún no hay cursos vinculados al catálogo vigente de WordPress." />}
    {tab === "issues" && <div>{sourceConflicts.length ? <div className="table-wrap"><table className="data"><thead><tr><th>Registro WordPress</th><th>ID externo</th><th>Motivo</th></tr></thead><tbody>{sourceConflicts.map((item) => <tr key={item.externalId}><td><strong>{item.title}</strong><div className="muted">{item.officialSlug}</div></td><td>{item.externalId}</td><td>{conflictReason[item.reason] ?? item.reason}</td></tr>)}</tbody></table></div> : null}<CourseTable courses={courseConflicts} empty={sourceConflicts.length ? "" : "No existen diferencias ni conflictos pendientes."} /></div>}
    {tab === "historical" && <CourseTable courses={historicalCourses} empty="No hay cursos históricos." />}
  </section>;
}
