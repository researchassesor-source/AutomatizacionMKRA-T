"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../Feedback";

type Curso = { id: string; title: string; enrollments: number; sessionsCount: number };

type CalendarStatus = "SIN_CALENDARIO_CRM" | "CALENDARIO_IGUAL" | "CALENDARIO_CAMBIADO" | "SIN_FECHA_EN_WORDPRESS" | "ERROR";

type SesionJSON = { startAt: string; endAt: string | null };

type Propuesta = {
  courseId: string;
  courseTitle: string;
  enrollments: number;
  status: CalendarStatus;
  motivo?: string;
  fuenteInicio?: string | null;
  sessions?: SesionJSON[];
  existingSessions?: SesionJSON[];
};

const formatoFecha = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
const formatoHora = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

function listaFechas(sesiones: SesionJSON[] | undefined) {
  return (sesiones ?? []).map((s) => `${formatoFecha.format(new Date(s.startAt))} · ${formatoHora.format(new Date(s.startAt))}`);
}

/**
 * Un solo boton para poner el catalogo al dia.
 *
 * Antes eran dos pasos separados: sincronizar con WordPress y, curso por
 * curso, traer las fechas. Son la misma intencion —"que el CRM refleje lo que
 * dice la web"— asi que van juntas.
 *
 * Lo que no cambia: las fechas siguen sin crearse ni actualizarse solas. Se
 * leen todas de una vez y se muestran juntas para confirmarlas, porque
 * programar (o reprogramar) el dia equivocado manda recordatorios reales a
 * personas reales. Antes solo se miraban los cursos SIN ninguna sesion, asi
 * que un cambio de fecha en WordPress sobre un curso que ya tenia sesiones
 * nunca se detectaba: el CRM seguia calculando mensajes sobre la fecha vieja.
 * Ahora se consultan todos los cursos publicados y se distingue cuando el
 * calendario cambio de cuando ya coincide.
 */
export function SyncEverythingButton({ courses, canSyncCatalog }: { courses: Curso[]; canSyncCatalog: boolean }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [fase, setFase] = useState<"idle" | "trabajando" | "revisando">("idle");
  const [paso, setPaso] = useState("");
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [procesando, setProcesando] = useState<Set<string>>(new Set());

  async function actualizar() {
    setFase("trabajando");

    if (canSyncCatalog) {
      setPaso("Sincronizando el catálogo con la web…");
      const sync = await fetch("/api/admin/courses/catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" }),
      }).catch(() => null);
      if (sync && !sync.ok) {
        const detalle = await sync.json().catch(() => ({}));
        toast({ tone: "warning", title: "El catálogo no se pudo sincronizar", detail: detalle.error ?? "Se continúa con las fechas." });
      }
    }

    const encontradas: Propuesta[] = [];
    for (const [indice, course] of courses.entries()) {
      setPaso(`Leyendo fechas (${indice + 1} de ${courses.length})…`);
      try {
        const response = await fetch(`/api/admin/courses/${course.id}/schedule-proposal`, { cache: "no-store" });
        const result = await response.json();
        const status: CalendarStatus = result.status ?? (result.ok ? "SIN_CALENDARIO_CRM" : "ERROR");
        // Sin ruido: si el calendario ya coincide, no hay nada que revisar.
        if (status === "CALENDARIO_IGUAL") continue;
        encontradas.push({
          courseId: course.id,
          courseTitle: course.title,
          enrollments: course.enrollments,
          status,
          motivo: result.motivo,
          fuenteInicio: result.fuenteInicio,
          sessions: result.sessions,
          existingSessions: result.existingSessions,
        });
      } catch {
        encontradas.push({ courseId: course.id, courseTitle: course.title, enrollments: course.enrollments, status: "ERROR", motivo: "No se pudo abrir la página del curso." });
      }
    }

    setPropuestas(encontradas);
    setFase("revisando");
    router.refresh();
  }

  /** Aplica un calendario YA CONFIRMADO. Nunca se llama sin que alguien haya pulsado un botón explícito. */
  async function aplicar(courseId: string, sesiones: SesionJSON[]): Promise<boolean> {
    const response = await fetch(`/api/admin/courses/${courseId}/schedule-proposal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true, sessions: sesiones }),
    });
    return response.ok;
  }

  /** Grupo de cursos sin ninguna sesión previa: confirmación en bloque, como antes. */
  async function confirmarNuevas() {
    setFase("trabajando");
    let cursos = 0;
    let sesiones = 0;
    for (const propuesta of nuevas) {
      setPaso(`Programando ${propuesta.courseTitle}…`);
      const ok = await aplicar(propuesta.courseId, propuesta.sessions ?? []);
      if (ok) {
        cursos++;
        sesiones += propuesta.sessions?.length ?? 0;
      }
    }
    setPropuestas((prev) => prev.filter((p) => p.status !== "SIN_CALENDARIO_CRM"));
    setFase("revisando");
    toast({
      tone: cursos > 0 ? "success" : "warning",
      title: cursos > 0 ? `${sesiones} sesiones programadas en ${cursos} curso${cursos === 1 ? "" : "s"}` : "No se programó ninguna sesión",
      detail: cursos > 0 ? "Los recordatorios ya se calcularon para quienes están inscritos." : undefined,
    });
    router.refresh();
  }

  /** Cambio de calendario de UN curso, decidido individualmente. */
  async function actualizarCalendario(propuesta: Propuesta) {
    setProcesando((prev) => new Set(prev).add(propuesta.courseId));
    try {
      const ok = await aplicar(propuesta.courseId, propuesta.sessions ?? []);
      if (ok) {
        setPropuestas((prev) => prev.filter((p) => p.courseId !== propuesta.courseId));
        toast({
          tone: "success",
          title: `Calendario de "${propuesta.courseTitle}" actualizado`,
          detail: "Se recalcularon únicamente los mensajes pendientes. Los ya enviados se conservan como historial.",
        });
        router.refresh();
      } else {
        toast({ tone: "warning", title: `No se pudo actualizar "${propuesta.courseTitle}"`, detail: "No se aplicó ningún cambio. Puedes intentarlo de nuevo." });
      }
    } finally {
      setProcesando((prev) => {
        const next = new Set(prev);
        next.delete(propuesta.courseId);
        return next;
      });
    }
  }

  function mantenerFechas(courseId: string) {
    setPropuestas((prev) => prev.filter((p) => p.courseId !== courseId));
  }

  const nuevas = propuestas.filter((item) => item.status === "SIN_CALENDARIO_CRM" && item.sessions?.length);
  const cambiadas = propuestas.filter((item) => item.status === "CALENDARIO_CAMBIADO");
  const sinFechas = propuestas.filter((item) => item.status === "SIN_FECHA_EN_WORDPRESS" || item.status === "ERROR");

  return (
    <>
      <button type="button" className="btn-sm" onClick={actualizar} disabled={fase === "trabajando"}>
        {fase === "trabajando" ? "Sincronizando…" : "Sincronizar con la web"}
      </button>

      {fase === "trabajando" && paso ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="status" aria-live="polite">
            <h2>Actualizando</h2>
            <p>{paso}</p>
            <div className="progress-bar" aria-hidden="true"><span /></div>
          </div>
        </div>
      ) : null}

      {fase === "revisando" ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="sync-titulo">
            <h2 id="sync-titulo">Esto encontré en la web</h2>
            <p>Revísalo antes de aplicar. Nada se crea ni se modifica hasta que confirmes.</p>

            {cambiadas.length > 0 ? (
              <div className="sync-group">
                <h3>Las fechas publicadas cambiaron</h3>
                {cambiadas.map((item) => (
                  <div className="sync-item" key={item.courseId}>
                    <strong>{item.courseTitle}</strong>
                    <p className="muted">Actual en CRM:</p>
                    <ul>{listaFechas(item.existingSessions).map((linea) => <li key={linea}>{linea}</li>)}</ul>
                    <p className="muted">Publicado en la web:</p>
                    <ul>{listaFechas(item.sessions).map((linea) => <li key={linea}>{linea}</li>)}</ul>
                    {item.enrollments > 0 ? (
                      <em>
                        Hay {item.enrollments} inscrito{item.enrollments === 1 ? "" : "s"}. Al aplicar el cambio se recalcularán únicamente los mensajes pendientes.
                        Los mensajes ya enviados se conservarán como historial.
                      </em>
                    ) : null}
                    <div className="dialog-actions">
                      <button type="button" className="btn-sm ghost" disabled={procesando.has(item.courseId)} onClick={() => mantenerFechas(item.courseId)}>
                        Mantener fechas actuales
                      </button>
                      <button type="button" className="btn-sm" disabled={procesando.has(item.courseId)} onClick={() => actualizarCalendario(item)}>
                        {procesando.has(item.courseId) ? "Actualizando…" : "Actualizar calendario"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {nuevas.length > 0 ? (
              <div className="sync-group">
                <h3>Con fechas publicadas</h3>
                {nuevas.map((item) => (
                  <div className="sync-item" key={item.courseId}>
                    <strong>{item.courseTitle}</strong>
                    <small>{item.fuenteInicio}</small>
                    <ul>{listaFechas(item.sessions).map((linea) => <li key={linea}>{linea}</li>)}</ul>
                    {item.enrollments > 0 ? <em>{item.enrollments} inscrito{item.enrollments === 1 ? "" : "s"} recibirán sus recordatorios</em> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {sinFechas.length > 0 ? (
              <div className="sync-group is-muted">
                <h3>Sin fecha todavía</h3>
                {sinFechas.map((item) => (
                  <div className="sync-item" key={item.courseId}>
                    <strong>{item.courseTitle}</strong>
                    <small>{item.motivo}</small>
                  </div>
                ))}
              </div>
            ) : null}

            {cambiadas.length === 0 && nuevas.length === 0 && sinFechas.length === 0 ? (
              <p className="muted">Todos los calendarios ya coinciden con lo publicado.</p>
            ) : null}

            <div className="dialog-actions">
              <button type="button" className="btn-sm ghost" onClick={() => { setFase("idle"); setPropuestas([]); }}>Cerrar</button>
              {nuevas.length > 0 ? (
                <button type="button" className="btn-sm" onClick={confirmarNuevas}>
                  Programar {nuevas.reduce((total, item) => total + (item.sessions?.length ?? 0), 0)} sesiones
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
