"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORIAS, type CategoriaTimeline, type EventoTimeline } from "@/lib/timeline/lead-timeline";

const ICONO: Record<CategoriaTimeline, string> = {
  MESSAGES: "💬",
  COMMERCE: "💳",
  AUTOMATION: "⚙️",
  SYSTEM: "•",
};

function hora(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "medium", timeStyle: "short" });
}

/**
 * Actividad del contacto, en una sola linea de tiempo.
 *
 * Lee de las tablas reales a traves del endpoint: no hay copia del historial,
 * asi que lo que se ve aqui es lo que hay. Se carga bajo demanda y por paginas
 * porque una ficha antigua puede tener cientos de mensajes y nadie los lee
 * todos de golpe.
 */
export function LeadTimeline({ leadId }: { leadId: string }) {
  const [eventos, setEventos] = useState<EventoTimeline[]>([]);
  const [categoria, setCategoria] = useState<"ALL" | CategoriaTimeline>("ALL");
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (before?: string) => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ category: categoria, limit: "30" });
      if (before) params.set("before", before);
      const res = await fetch(`/api/admin/leads/${leadId}/timeline?${params}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("No se pudo cargar la actividad.");
        return;
      }
      setError(null);
      setEventos((previos) => (before ? [...previos, ...json.events] : json.events));
      setSiguiente(json.nextBefore ?? null);
    } catch {
      setError("No se pudo cargar la actividad.");
    } finally {
      setCargando(false);
    }
  }, [leadId, categoria]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <section className="panel">
      <h2>Actividad</h2>

      <fieldset className="inbox-filters" aria-label="Filtrar actividad">
        {CATEGORIAS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`btn-sm ${categoria === item.key ? "" : "ghost"}`}
            aria-pressed={categoria === item.key}
            onClick={() => setCategoria(item.key)}
          >
            {item.label}
          </button>
        ))}
      </fieldset>

      {cargando && eventos.length === 0 ? <p className="muted">Cargando actividad…</p> : null}
      {error ? <p className="result-line is-error" role="status">{error}</p> : null}
      {!cargando && !error && eventos.length === 0 ? (
        <p className="muted">Aún no hay actividad para este filtro.</p>
      ) : null}

      <ol className="timeline">
        {eventos.map((evento) => (
          <li key={evento.id} className="timeline-item">
            <span className="timeline-icon" aria-hidden="true">{ICONO[evento.category]}</span>
            <div>
              <p className="timeline-title">
                <strong>{evento.title}</strong>
                {evento.status ? <span className="muted"> · {evento.status}</span> : null}
              </p>
              {evento.description ? <p className="muted">{evento.description}</p> : null}
              <p className="muted">{hora(evento.timestamp)}</p>
            </div>
          </li>
        ))}
      </ol>

      {siguiente ? (
        <button type="button" className="btn-sm ghost" disabled={cargando} onClick={() => void cargar(siguiente)}>
          {cargando ? "Cargando…" : "Ver actividad anterior"}
        </button>
      ) : null}
    </section>
  );
}
