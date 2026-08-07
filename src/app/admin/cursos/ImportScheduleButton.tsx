"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFeedback } from "../Feedback";

type Propuesta =
  | { ok: true; sessions: Array<{ startAt: string; endAt: string | null }>; fuenteInicio: string; fuenteHorario: string | null; sourceUrl: string }
  | { ok: false; motivo: string; fuenteInicio: string | null; fuenteHorario: string | null; sourceUrl?: string };

const formato = new Intl.DateTimeFormat("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Guayaquil" });
const hora = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" });

/**
 * Traer las fechas desde la ficha publica del curso.
 *
 * La web ya publica "Inicio" y "Horario"; escribirlos otra vez a mano es
 * trabajo duplicado y una oportunidad de equivocarse. Pero tampoco se crean
 * solas: se muestran las fechas leidas, con su texto de origen a la vista, y
 * la persona confirma. Si algo no cuadra, se ve antes de programar nada.
 */
export function ImportScheduleButton({
  courseId,
  enrollments,
  label = "Traer fechas de la web",
}: {
  courseId: string;
  enrollments: number;
  label?: string;
}) {
  const router = useRouter();
  const { toast } = useFeedback();
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function consultar() {
    setCargando(true);
    try {
      const response = await fetch(`/api/admin/courses/${courseId}/schedule-proposal`, { cache: "no-store" });
      const result = (await response.json()) as Propuesta;
      setPropuesta(result);
    } catch {
      toast({ tone: "error", title: "No se pudo consultar la página del curso", detail: "Revisa tu conexión e inténtalo de nuevo." });
    }
    setCargando(false);
  }

  async function confirmar() {
    if (!propuesta?.ok) return;
    setGuardando(true);
    let creadas = 0;
    let fallidas = 0;
    for (const session of propuesta.sessions) {
      const response = await fetch(`/api/admin/courses/${courseId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt: session.startAt, endAt: session.endAt ?? undefined }),
      });
      if (response.ok) creadas++;
      else fallidas++;
    }
    setGuardando(false);
    setPropuesta(null);

    if (creadas > 0) {
      toast({
        tone: "success",
        title: creadas === 1 ? "Sesión programada" : `${creadas} sesiones programadas`,
        detail: enrollments > 0
          ? `${enrollments} ${enrollments === 1 ? "persona recibirá sus recordatorios" : "personas recibirán sus recordatorios"} según estas fechas.`
          : "Todavía no hay nadie inscrito en este curso.",
      });
      toast({
        tone: "warning",
        title: "El enlace de acceso todavía está pendiente",
        detail: "Puedes añadirlo en el calendario del curso. Los recordatorios que lo necesiten esperarán a que esté disponible.",
      });
    }
    if (fallidas > 0) {
      toast({ tone: "error", title: `${fallidas} sesión(es) no se pudieron crear`, detail: "Revisa el calendario del curso." });
    }
    router.refresh();
  }

  if (!propuesta) {
    return (
      <button type="button" className="btn-sm ghost" onClick={consultar} disabled={cargando}>
        {cargando ? "Consultando…" : label}
      </button>
    );
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="import-titulo">
        <h2 id="import-titulo">Fechas encontradas en la web</h2>

        {propuesta.ok ? (
          <>
            <p>Esto es lo que publica la ficha oficial del curso. Revísalo antes de programar.</p>

            <div className="import-source">
              <span><strong>Inicio:</strong> {propuesta.fuenteInicio}</span>
              {propuesta.fuenteHorario ? <span><strong>Horario:</strong> {propuesta.fuenteHorario}</span> : null}
            </div>

            <ul className="import-list">
              {propuesta.sessions.map((session) => (
                <li key={session.startAt}>
                  <strong>{formato.format(new Date(session.startAt))}</strong>
                  <span>
                    {hora.format(new Date(session.startAt))}
                    {session.endAt ? ` – ${hora.format(new Date(session.endAt))}` : ""}
                  </span>
                </li>
              ))}
            </ul>

            <p className="import-note">
              Se crearán {propuesta.sessions.length} sesión{propuesta.sessions.length === 1 ? "" : "es"}. El enlace de acceso se agrega después.
            </p>

            <div className="dialog-actions">
              <button type="button" className="btn-sm ghost" onClick={() => setPropuesta(null)} disabled={guardando}>Cancelar</button>
              <button type="button" className="btn-sm" onClick={confirmar} disabled={guardando}>
                {guardando ? "Programando…" : "Programar estas fechas"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{propuesta.motivo}</p>
            {propuesta.fuenteInicio ? (
              <div className="import-source">
                <span><strong>Lo que dice la web:</strong> {propuesta.fuenteInicio}</span>
                {propuesta.fuenteHorario ? <span><strong>Horario:</strong> {propuesta.fuenteHorario}</span> : null}
              </div>
            ) : null}
            <p className="import-note">Puedes programarla a mano con el botón «Programar sesión».</p>
            <div className="dialog-actions">
              <button type="button" className="btn-sm" onClick={() => setPropuesta(null)}>Entendido</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
