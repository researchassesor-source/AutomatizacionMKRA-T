"use client";

import { useEffect, useMemo, useState } from "react";

type FinanceService = { id: string; nombre: string; modalidad: string };

/** Para sugerir por nombre solo cuando el calce es inequívoco. */
const MARCAS_DIACRITICAS = new RegExp("[̀-ͯ]", "g");

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(MARCAS_DIACRITICAS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * "Configurar Finance" (sección R del release de estabilización).
 *
 * Reemplaza el campo de ID técnico como experiencia final: quien administra
 * elige de una lista de Servicios activos reales, nunca copia/pega un
 * identificador a mano. La llamada a Finance es servidor-a-servidor
 * (/api/admin/finance/services); aquí nunca se ve token, usuario, contraseña
 * ni URL privada de Finance, solo nombre/modalidad.
 */
export function FinanceServiceModal({
  courseId,
  courseTitle,
  currentServiceId,
  onSaved,
  onClose,
}: {
  courseId: string;
  courseTitle: string;
  currentServiceId: string | null;
  onSaved: (id: string | null) => void;
  onClose: () => void;
}) {
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");
  const [error, setError] = useState<string | null>(null);
  const [servicios, setServicios] = useState<FinanceService[]>([]);
  const [filtro, setFiltro] = useState("");
  const [seleccionado, setSeleccionado] = useState<string | null>(currentServiceId);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const response = await fetch("/api/admin/finance/services", { cache: "no-store" }).catch(() => null);
      if (cancelado) return;
      if (!response || !response.ok) {
        const detalle = await response?.json().catch(() => ({}));
        setError(detalle?.error ?? "No se pudo conectar con Finance.");
        setEstado("error");
        return;
      }
      const body = await response.json();
      setServicios(body.services ?? []);
      setEstado("listo");
    })();
    return () => { cancelado = true; };
  }, []);

  const filtrados = useMemo(() => {
    const q = normalizar(filtro);
    if (!q) return servicios;
    return servicios.filter((s) => normalizar(s.nombre).includes(q) || normalizar(s.modalidad).includes(q));
  }, [servicios, filtro]);

  /** Solo si hay EXACTAMENTE un servicio cuyo nombre coincide con el del curso. */
  const sugerido = useMemo(() => {
    if (currentServiceId || servicios.length === 0) return null;
    const q = normalizar(courseTitle);
    const coincidencias = servicios.filter((s) => normalizar(s.nombre) === q);
    return coincidencias.length === 1 ? coincidencias[0] : null;
  }, [servicios, courseTitle, currentServiceId]);

  async function guardar(id: string | null) {
    setGuardando(true);
    setError(null);
    const response = await fetch(`/api/admin/courses/${courseId}/finance-service`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ financeServiceId: id, confirm: true }),
    }).catch(() => null);
    setGuardando(false);
    if (!response || !response.ok) {
      const detalle = await response?.json().catch(() => ({}));
      setError(detalle?.error ?? "No se pudo guardar.");
      return;
    }
    onSaved(id);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="finance-modal-titulo">
        <h2 id="finance-modal-titulo">Configurar Finance</h2>
        <p className="muted">
          Vincula «{courseTitle}» a un Servicio activo de Finance. Sin vincular, Finance sigue emparejando por el
          nombre del curso.
        </p>

        {estado === "cargando" ? <p className="muted">Consultando servicios activos…</p> : null}
        {estado === "error" ? (
          <p className="feedback-error">{error ?? "No se pudo conectar con Finance."}</p>
        ) : null}

        {estado === "listo" ? (
          <>
            {sugerido ? (
              <div className="finance-sugerencia">
                <span>¿Es este? <strong>{sugerido.nombre}</strong> · {sugerido.modalidad}</span>
                <button type="button" className="btn-sm ghost" onClick={() => setSeleccionado(sugerido.id)} disabled={guardando}>
                  Usar esta sugerencia
                </button>
              </div>
            ) : null}

            <input
              type="search"
              aria-label="Buscar servicio"
              placeholder="Buscar por nombre o modalidad…"
              value={filtro}
              onChange={(event) => setFiltro(event.target.value)}
              disabled={guardando}
            />

            <div className="finance-service-list" role="listbox" aria-label="Servicios activos de Finance">
              <label className="finance-service-row">
                <input type="radio" name="finance-service" checked={seleccionado === null} onChange={() => setSeleccionado(null)} disabled={guardando} />
                <span><em>Sin vincular</em> — Finance empareja por nombre del curso</span>
              </label>
              {filtrados.map((servicio) => (
                <label className="finance-service-row" key={servicio.id}>
                  <input
                    type="radio"
                    name="finance-service"
                    checked={seleccionado === servicio.id}
                    onChange={() => setSeleccionado(servicio.id)}
                    disabled={guardando}
                  />
                  <span>{servicio.nombre} <small>· {servicio.modalidad}</small></span>
                </label>
              ))}
              {filtrados.length === 0 ? <p className="muted">Ningún servicio activo coincide con la búsqueda.</p> : null}
            </div>
          </>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn-sm ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          {estado === "listo" ? (
            <button type="button" className="btn-sm" onClick={() => guardar(seleccionado)} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
