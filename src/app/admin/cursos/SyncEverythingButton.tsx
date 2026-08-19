"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../Feedback";

type ItemStatus = "NEW_COURSE" | "SCHEDULE_CHANGED" | "NO_SCHEDULE_SOURCE" | "ERROR";
type SesionJSON = { startAt: string; endAt: string | null };
type ExistingSessionJSON = { startAt: string; endAt: string | null };

type DiffItem = {
  courseId: string;
  courseTitle: string;
  status: ItemStatus;
  motivo?: string;
  fuenteInicio?: string | null;
  sessions?: SesionJSON[];
  existingSessions: ExistingSessionJSON[];
  calendarRevision: string;
  enrollments: number;
};

type Totals = { unchanged: number; newCourse: number; scheduleChanged: number; noScheduleSource: number; error: number };

const formatoFecha = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
const formatoHora = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

function listaFechas(sesiones: SesionJSON[] | undefined) {
  return (sesiones ?? []).map((s) => `${formatoFecha.format(new Date(s.startAt))} · ${formatoHora.format(new Date(s.startAt))}`);
}

/**
 * Un solo botón, un solo viaje de servidor, una sola confirmación.
 *
 * Antes: sincronizar catálogo -> refrescar la lista EN EL NAVEGADOR -> un GET
 * por curso sobre esa lista ya vieja -> un curso nuevo, descubierto por el
 * mismo sync, quedaba fuera hasta un segundo clic. Ahora todo el trabajo
 * (sincronizar, descubrir nuevos, leer TODOS los calendarios) ocurre en el
 * servidor dentro de una sola llamada a /catalog/analyze (sección K del
 * release de estabilización), y "Aplicar todos los cambios seguros" manda
 * exactamente lo que se mostró a /catalog/apply-all en una sola confirmación
 * global (sección L) — nunca curso por curso.
 */
export function SyncEverythingButton({ canSyncCatalog }: { canSyncCatalog: boolean }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [fase, setFase] = useState<"idle" | "analizando" | "revisando" | "aplicando">("idle");
  const [totals, setTotals] = useState<Totals | null>(null);
  const [items, setItems] = useState<DiffItem[]>([]);
  const [excluidos, setExcluidos] = useState<Set<string>>(new Set());

  async function analizar() {
    setFase("analizando");
    const response = await fetch("/api/admin/courses/catalog/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" }),
    }).catch(() => null);

    if (!response || !response.ok) {
      const detalle = await response?.json().catch(() => ({}));
      toast({ tone: "warning", title: "No se pudo sincronizar con la web", detail: detalle?.error ?? "Inténtalo de nuevo en un momento." });
      setFase("idle");
      return;
    }
    const body = await response.json();
    setTotals(body.totals);
    setItems(body.items ?? []);
    setExcluidos(new Set());
    setFase("revisando");
    router.refresh();
  }

  const nuevos = items.filter((item) => item.status === "NEW_COURSE");
  const cambiados = items.filter((item) => item.status === "SCHEDULE_CHANGED");
  const sinFecha = items.filter((item) => item.status === "NO_SCHEDULE_SOURCE" || item.status === "ERROR");
  const aplicables = [...nuevos, ...cambiados].filter((item) => !excluidos.has(item.courseId));

  function alternarExclusion(courseId: string) {
    setExcluidos((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }

  async function aplicarTodos() {
    if (aplicables.length === 0) return;
    setFase("aplicando");
    const response = await fetch("/api/admin/courses/catalog/apply-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: "APPLY_ALL_SAFE_CHANGES",
        items: aplicables.map((item) => ({ courseId: item.courseId, calendarRevision: item.calendarRevision, sessions: item.sessions ?? [] })),
      }),
    }).catch(() => null);

    if (!response || !response.ok) {
      toast({ tone: "warning", title: "No se pudo aplicar los cambios", detail: "Inténtalo de nuevo." });
      setFase("revisando");
      return;
    }
    const body = await response.json();
    const stale: string[] = (body.resultados ?? []).filter((r: { ok: boolean; code?: string }) => !r.ok && r.code === "REVISION_MISMATCH").map((r: { courseId: string }) => r.courseId);
    toast({
      tone: body.fallidos > 0 || body.desactualizados > 0 ? "warning" : "success",
      title: `${body.aplicados} curso${body.aplicados === 1 ? "" : "s"} actualizado${body.aplicados === 1 ? "" : "s"}`,
      detail: body.desactualizados > 0
        ? `${body.desactualizados} curso${body.desactualizados === 1 ? "" : "s"} cambió mientras revisabas; vuelve a sincronizarlo${body.desactualizados === 1 ? "" : "s"}.`
        : body.fallidos > 0
          ? `${body.fallidos} curso${body.fallidos === 1 ? "" : "s"} no se pudo actualizar. Puedes reintentarlo.`
          : "Los recordatorios ya se recalcularon para quienes están inscritos.",
    });
    // Los que quedaron desactualizados o fallidos siguen en pantalla para reintentar; el resto se retira.
    setItems((prev) => prev.filter((item) => stale.includes(item.courseId) || item.status === "NO_SCHEDULE_SOURCE" || item.status === "ERROR" || excluidos.has(item.courseId)));
    setFase(items.some((item) => stale.includes(item.courseId)) ? "revisando" : "idle");
    router.refresh();
  }

  if (!canSyncCatalog) return null;

  return (
    <>
      <button type="button" className="btn-sm" onClick={analizar} disabled={fase === "analizando"}>
        {fase === "analizando" ? "Sincronizando…" : "Sincronizar con la web"}
      </button>

      {fase === "analizando" ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="status" aria-live="polite">
            <h2>Sincronizando</h2>
            <p>Leyendo el catálogo y el calendario de cada curso…</p>
            <div className="progress-bar" aria-hidden="true"><span /></div>
          </div>
        </div>
      ) : null}

      {(fase === "revisando" || fase === "aplicando") && totals ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="sync-titulo">
            <h2 id="sync-titulo">Esto encontré en la web</h2>
            <p className="sync-resumen">
              <strong>{totals.unchanged}</strong> sin cambios · <strong>{totals.scheduleChanged}</strong> con nuevas fechas ·{" "}
              <strong>{totals.newCourse}</strong> nuevo{totals.newCourse === 1 ? "" : "s"} · <strong>{totals.noScheduleSource + totals.error}</strong> sin fecha
            </p>
            <p className="muted">Revísalo antes de aplicar. Nada se crea ni se modifica hasta que confirmes.</p>

            {cambiados.length > 0 ? (
              <div className="sync-group">
                <h3>Las fechas publicadas cambiaron</h3>
                {cambiados.map((item) => (
                  <label className="sync-item" key={item.courseId}>
                    <input type="checkbox" checked={!excluidos.has(item.courseId)} onChange={() => alternarExclusion(item.courseId)} disabled={fase === "aplicando"} />
                    <div>
                      <strong>{item.courseTitle}</strong>
                      <p className="muted">Actual en CRM:</p>
                      <ul>{listaFechas(item.existingSessions).map((linea) => <li key={linea}>{linea}</li>)}</ul>
                      <p className="muted">Publicado en la web:</p>
                      <ul>{listaFechas(item.sessions).map((linea) => <li key={linea}>{linea}</li>)}</ul>
                      {item.enrollments > 0 ? (
                        <em>Hay {item.enrollments} inscrito{item.enrollments === 1 ? "" : "s"}. Se recalcularán únicamente los mensajes pendientes.</em>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            ) : null}

            {nuevos.length > 0 ? (
              <div className="sync-group">
                <h3>Cursos nuevos, con fecha publicada</h3>
                {nuevos.map((item) => (
                  <label className="sync-item" key={item.courseId}>
                    <input type="checkbox" checked={!excluidos.has(item.courseId)} onChange={() => alternarExclusion(item.courseId)} disabled={fase === "aplicando"} />
                    <div>
                      <strong>{item.courseTitle}</strong>
                      <small>{item.fuenteInicio}</small>
                      <ul>{listaFechas(item.sessions).map((linea) => <li key={linea}>{linea}</li>)}</ul>
                    </div>
                  </label>
                ))}
              </div>
            ) : null}

            {sinFecha.length > 0 ? (
              <div className="sync-group is-muted">
                <h3>Sin fecha todavía</h3>
                {sinFecha.map((item) => (
                  <div className="sync-item" key={item.courseId}>
                    <strong>{item.courseTitle}</strong>
                    <small>{item.motivo}</small>
                  </div>
                ))}
              </div>
            ) : null}

            {items.length === 0 ? <p className="muted">Todos los calendarios ya coinciden con lo publicado.</p> : null}

            <div className="dialog-actions">
              <button type="button" className="btn-sm ghost" onClick={() => { setFase("idle"); setTotals(null); setItems([]); }} disabled={fase === "aplicando"}>
                Cerrar
              </button>
              {aplicables.length > 0 ? (
                <button type="button" className="btn-sm" onClick={aplicarTodos} disabled={fase === "aplicando"}>
                  {fase === "aplicando" ? "Aplicando…" : `Aplicar todos los cambios seguros (${aplicables.length})`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
