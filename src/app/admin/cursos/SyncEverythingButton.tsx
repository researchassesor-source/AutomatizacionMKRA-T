"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../Feedback";

type Curso = { id: string; title: string; enrollments: number; sessionsCount: number };

type Propuesta = {
  courseId: string;
  courseTitle: string;
  enrollments: number;
  ok: boolean;
  motivo?: string;
  fuenteInicio?: string | null;
  sessions?: Array<{ startAt: string; endAt: string | null }>;
};

const formatoFecha = new Intl.DateTimeFormat("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
const formatoHora = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

/**
 * Un solo boton para poner el catalogo al dia.
 *
 * Antes eran dos pasos separados: sincronizar con WordPress y, curso por
 * curso, traer las fechas. Son la misma intencion —"que el CRM refleje lo que
 * dice la web"— asi que van juntas.
 *
 * Lo que no cambia: las fechas siguen sin crearse solas. Se leen todas de una
 * vez y se muestran juntas para confirmarlas en un gesto, porque programar el
 * dia equivocado manda recordatorios reales a personas reales.
 */
export function SyncEverythingButton({ courses, canSyncCatalog }: { courses: Curso[]; canSyncCatalog: boolean }) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [fase, setFase] = useState<"idle" | "trabajando" | "revisando">("idle");
  const [paso, setPaso] = useState("");
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);

  const sinFecha = courses.filter((course) => course.sessionsCount === 0);

  async function actualizar() {
    setFase("trabajando");

    if (canSyncCatalog) {
      setPaso("Sincronizando el catálogo con la web…");
      const sync = await fetch("/api/admin/courses/catalog/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      }).catch(() => null);
      if (sync && !sync.ok) {
        const detalle = await sync.json().catch(() => ({}));
        toast({ tone: "warning", title: "El catálogo no se pudo sincronizar", detail: detalle.error ?? "Se continúa con las fechas." });
      }
    }

    const encontradas: Propuesta[] = [];
    for (const [indice, course] of sinFecha.entries()) {
      setPaso(`Leyendo fechas (${indice + 1} de ${sinFecha.length})…`);
      try {
        const response = await fetch(`/api/admin/courses/${course.id}/schedule-proposal`, { cache: "no-store" });
        const result = await response.json();
        encontradas.push({
          courseId: course.id,
          courseTitle: course.title,
          enrollments: course.enrollments,
          ok: Boolean(result.ok),
          motivo: result.motivo,
          fuenteInicio: result.fuenteInicio,
          sessions: result.sessions,
        });
      } catch {
        encontradas.push({ courseId: course.id, courseTitle: course.title, enrollments: course.enrollments, ok: false, motivo: "No se pudo abrir la página del curso." });
      }
    }

    setPropuestas(encontradas);
    setFase("revisando");
    router.refresh();
  }

  async function confirmar() {
    setFase("trabajando");
    let cursos = 0;
    let sesiones = 0;
    for (const propuesta of propuestas.filter((item) => item.ok && item.sessions?.length)) {
      setPaso(`Programando ${propuesta.courseTitle}…`);
      let creadas = 0;
      for (const session of propuesta.sessions ?? []) {
        const response = await fetch(`/api/admin/courses/${propuesta.courseId}/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startAt: session.startAt, endAt: session.endAt ?? undefined }),
        });
        if (response.ok) creadas++;
      }
      if (creadas > 0) {
        cursos++;
        sesiones += creadas;
      }
    }
    setFase("idle");
    setPropuestas([]);
    toast({
      tone: cursos > 0 ? "success" : "warning",
      title: cursos > 0 ? `${sesiones} sesiones programadas en ${cursos} curso${cursos === 1 ? "" : "s"}` : "No se programó ninguna sesión",
      detail: cursos > 0 ? "Los recordatorios ya se calcularon para quienes están inscritos." : undefined,
    });
    router.refresh();
  }

  const conFechas = propuestas.filter((item) => item.ok && item.sessions?.length);
  const sinFechas = propuestas.filter((item) => !item.ok);

  return (
    <>
      <button type="button" className="btn-sm" onClick={actualizar} disabled={fase === "trabajando"}>
        {fase === "trabajando" ? "Actualizando…" : "Actualizar catálogo y fechas"}
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
            <p>Revísalo antes de programar. Nada se crea hasta que confirmes.</p>

            {conFechas.length > 0 ? (
              <div className="sync-group">
                <h3>Con fechas publicadas</h3>
                {conFechas.map((item) => (
                  <div className="sync-item" key={item.courseId}>
                    <strong>{item.courseTitle}</strong>
                    <small>{item.fuenteInicio}</small>
                    <ul>
                      {(item.sessions ?? []).map((session) => (
                        <li key={session.startAt}>
                          {formatoFecha.format(new Date(session.startAt))} · {formatoHora.format(new Date(session.startAt))}
                        </li>
                      ))}
                    </ul>
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

            <div className="dialog-actions">
              <button type="button" className="btn-sm ghost" onClick={() => { setFase("idle"); setPropuestas([]); }}>Cerrar</button>
              {conFechas.length > 0 ? (
                <button type="button" className="btn-sm" onClick={confirmar}>
                  Programar {conFechas.reduce((total, item) => total + (item.sessions?.length ?? 0), 0)} sesiones
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
