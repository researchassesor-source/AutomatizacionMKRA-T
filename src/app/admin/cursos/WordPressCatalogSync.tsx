"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncRun = { id: string; status: string; discovered: number; created: number; updated: number; conflicts: number; errors: number; error: string | null; startedAt: string; completedAt: string | null };

export function WordPressCatalogSync({ configured, latestRun }: { configured: boolean; latestRun: SyncRun | null }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null);
  async function sync() {
    if (!window.confirm("La operación realizará únicamente solicitudes GET al endpoint REST y no eliminará cursos ausentes ni sobrescribirá campos internos. ¿Continuar?")) return;
    setBusy(true); const response = await fetch("/api/admin/courses/catalog/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" }) });
    const result = await response.json().catch(() => ({})); setBusy(false);
    setMessage(response.ok ? `Sincronización terminada: ${result.created} nuevos, ${result.updated} actualizados, ${result.conflicts} conflictos y ${result.errors} errores.` : result.error ?? "No se pudo sincronizar.");
    if (response.ok) router.refresh();
  }
  return <section className="panel"><div className="panel-header"><div><h2>Sincronización WordPress · solo lectura</h2><p>Vincula exclusivamente mediante WordPress ID y fuente externa. Los campos internos y cursos ausentes se preservan.</p></div><button type="button" className="btn-sm" disabled={busy || !configured} onClick={sync}>{busy ? "Sincronizando…" : "Sincronizar catálogo"}</button></div>
    {!configured && <p className="admin-notice"><strong>Bloqueado:</strong> falta `WORDPRESS_COURSES_API_URL`. Si el endpoint no es público, se necesita una cuenta técnica con permiso mínimo para leer el tipo de contenido de cursos mediante REST; no requiere editar páginas, plugins ni configuración.</p>}
    {latestRun && <dl className="detail-list"><dt>Última ejecución</dt><dd>{new Date(latestRun.startedAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</dd><dt>Estado</dt><dd>{latestRun.status}</dd><dt>Resultado</dt><dd>{latestRun.discovered} encontrados · {latestRun.created} nuevos · {latestRun.updated} actualizados · {latestRun.conflicts} conflictos · {latestRun.errors} errores</dd>{latestRun.error && <><dt>Error controlado</dt><dd>{latestRun.error}</dd></>}</dl>}
    {message && <p className="result-line" role="status">{message}</p>}
  </section>;
}
