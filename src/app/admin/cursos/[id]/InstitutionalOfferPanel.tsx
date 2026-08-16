"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ESTADO_CAMPANA,
  etiquetaComercial,
  etiquetaOferta,
  puedeEnviar as sePuedeEnviar,
  puedeSeleccionarse,
  seleccionablesDe,
  textoConfirmacion,
} from "@/lib/commerce/offer-presentation";
import { useFeedback } from "../../Feedback";

/**
 * Oferta institucional del curso.
 *
 * Este panel PRESENTA; quien decide es el backend. No hay ninguna regla de
 * elegibilidad aqui: los estados llegan calculados de
 * `/api/admin/commerce/campaign` y lo unico que hace React es pintarlos y
 * ofrecer las acciones. Duplicar la elegibilidad en el navegador significaria
 * que un dia las dos versiones discrepan y la pantalla enseña algo que el
 * servidor no va a hacer.
 *
 * La seleccion tampoco vive en React: se persiste en
 * `CertificationOfferRecipient`. Guardarla solo en memoria haria que recargar
 * la pagina borrara el trabajo de elegir a mano entre decenas de personas, que
 * es justo el caso de la primera campaña.
 */

type Destinatario = {
  enrollmentId: string;
  nombre: string;
  telefono: string | null;
  estado: string;
  estadoComercial: string | null;
  advertencia: string | null;
  seleccionado: boolean;
  excluido: boolean;
  enviadoManual: string | null;
  enviadoAutomatico: string | null;
  motivo: string | null;
};

type Campana = {
  id: string;
  audienceMode: "HISTORICAL_MANUAL" | "AUTOMATIC_COMMERCE";
  status: string;
  automaticScheduledAt: string | null;
  automaticExecutedAt: string | null;
  curso: string;
  urlOferta: string | null;
  precio: number | null;
  delayHoras: number;
};

type Contadores = {
  participantes: number;
  seleccionados: number;
  enviadosManualmente: number;
  enviadosAutomaticamente: number;
  pendientes: number;
  excluidos: number;
  requierenRevision: number;
};

type Respuesta = { campana: Campana | null; destinatarios?: Destinatario[]; contadores?: Contadores };

export function InstitutionalOfferPanel({ courseId, canEdit }: { courseId: string; canEdit: boolean }) {
  const { toast, confirm } = useFeedback();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [marcados, setMarcados] = useState<string[]>([]);

  const cargar = useCallback(async () => {
    const respuesta = await fetch(`/api/admin/commerce/campaign?courseId=${encodeURIComponent(courseId)}`);
    const cuerpo = await respuesta.json().catch(() => ({}));
    setDatos(respuesta.ok ? cuerpo : { campana: null });
    setCargando(false);
  }, [courseId]);

  useEffect(() => { void cargar(); }, [cargar]);

  /** Toda mutacion pasa por aqui: un solo sitio que bloquea el doble envio. */
  async function ejecutar(cuerpo: Record<string, unknown>, exito: string) {
    if (ocupado || !canEdit) return null;
    setOcupado(true);
    try {
      const respuesta = await fetch("/api/admin/commerce/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      const resultado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) {
        // No se toca la seleccion ni se marca nada como enviado: el fallo deja
        // todo como estaba para poder reintentar.
        toast({ tone: "error", title: "No se pudo completar la acción", detail: resultado.error ?? "Inténtalo de nuevo." });
        return null;
      }
      // Se recarga desde el servidor en vez de suponer el resultado.
      await cargar();
      toast({ tone: "success", title: exito });
      return resultado;
    } finally {
      setOcupado(false);
    }
  }

  if (cargando) return <section className="panel"><p className="muted">Cargando la oferta institucional…</p></section>;

  const campana = datos?.campana ?? null;
  const destinatarios = datos?.destinatarios ?? [];
  const contadores = datos?.contadores;

  if (!campana) {
    return (
      <section className="panel">
        <h2>Oferta institucional</h2>
        <p className="muted">Curso completo de 60 horas + certificado institucional R.A. Training.</p>
        <p className="muted">Este curso todavía no tiene campaña de oferta preparada.</p>
        {canEdit ? (
          <div className="card-actions">
            <button type="button" className="btn-sm" disabled={ocupado}
              onClick={() => ejecutar({ accion: "crear", courseId, audienceMode: "HISTORICAL_MANUAL" }, "Campaña histórica preparada")}>
              Preparar campaña histórica — selección manual
            </button>
            <button type="button" className="btn-sm ghost" disabled={ocupado}
              onClick={() => ejecutar({ accion: "crear", courseId, audienceMode: "AUTOMATIC_COMMERCE" }, "Campaña automática preparada")}>
              Preparar campaña automática
            </button>
          </div>
        ) : null}
        <p className="muted">
          La histórica no envía nunca sola: seleccionas tú a quién escribir. La automática consulta Finance y envía tras el curso.
        </p>
      </section>
    );
  }

  const historica = campana.audienceMode === "HISTORICAL_MANUAL";
  const faltaUrl = !campana.urlOferta?.trim();
  // Sin destino no se escribe a nadie, aunque el backend lo rechazaria igual.
  const seleccionables = seleccionablesDe(destinatarios, canEdit);
  const puedeEnviar = sePuedeEnviar({ puedeEditar: canEdit, urlOferta: campana.urlOferta, marcados, ocupado });

  function alternar(enrollmentId: string) {
    setMarcados((actual) => actual.includes(enrollmentId) ? actual.filter((id) => id !== enrollmentId) : [...actual, enrollmentId]);
  }

  // Expresion y no declaracion: asi TypeScript conserva que `campana` ya no es
  // nula despues del retorno temprano de arriba.
  const enviar = async () => {
    const ok = await confirm({
      title: "Enviar la oferta institucional",
      body: textoConfirmacion({
        marcados: marcados.length,
        enviadosManualmente: contadores?.enviadosManualmente ?? 0,
        excluidos: contadores?.excluidos ?? 0,
        pendientes: contadores?.pendientes ?? 0,
      }),
      confirmLabel: "Preparar envío",
    });
    if (!ok) return;
    const resultado = await ejecutar(
      { accion: "enviar", campaignId: campana.id, enrollmentIds: marcados, confirm: true },
      "Oferta encolada",
    );
    if (resultado) setMarcados([]);
  };

  return (
    <section className="panel">
      <h2>Oferta institucional</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Curso completo de 60 horas + certificado institucional R.A. Training.
      </p>

      <div className="summary-line">
        <span>Precio: <strong>{campana.precio !== null ? `$${campana.precio}` : "sin definir"}</strong></span>
        <span className="summary-sep">·</span>
        <span>Estado: <strong>{ESTADO_CAMPANA[campana.status] ?? campana.status}</strong></span>
        {!historica && campana.automaticScheduledAt ? (
          <>
            <span className="summary-sep">·</span>
            <span>Envío automático: <strong>{new Date(campana.automaticScheduledAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}</strong></span>
          </>
        ) : null}
      </div>

      {historica ? (
        <p className="mode-banner is-warn">
          <strong>Campaña histórica — envío automático desactivado.</strong>
          <span>Selecciona manualmente las personas que deben recibir la oferta.</span>
        </p>
      ) : null}

      {faltaUrl ? (
        <p className="mode-banner is-warn">
          <strong>Falta configurar el enlace de la oferta institucional.</strong>
          <span>Hasta que lo añadas no se puede enviar. Se configura en la pestaña Configuración.</span>
        </p>
      ) : null}
      {campana.precio === null ? (
        <p className="muted">Aún no has definido el precio de la oferta institucional.</p>
      ) : null}

      {contadores ? (
        <div className="offer-counters">
          {([
            ["Participantes", contadores.participantes],
            ["Seleccionados", contadores.seleccionados],
            ["Enviados manualmente", contadores.enviadosManualmente],
            ["Enviados automáticamente", contadores.enviadosAutomaticamente],
            ["Pendientes", contadores.pendientes],
            ["Excluidos", contadores.excluidos],
            ["Requieren revisión", contadores.requierenRevision],
          ] as const).map(([etiqueta, valor]) => (
            <span key={etiqueta}><strong>{valor}</strong> {etiqueta}</span>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        <div className="card-actions">
          <button type="button" className="btn-sm ghost" disabled={ocupado}
            onClick={() => setMarcados(seleccionables)}>Seleccionar todos</button>
          <button type="button" className="btn-sm ghost" disabled={ocupado} onClick={() => setMarcados([])}>Deseleccionar todos</button>
          <button type="button" className="btn-sm ghost" disabled={ocupado || marcados.length === 0}
            onClick={() => ejecutar({ accion: "seleccionar", campaignId: campana.id, enrollmentIds: marcados }, "Selección guardada")}>
            Guardar selección
          </button>
          <button type="button" className="btn-sm ghost" disabled={ocupado || marcados.length === 0}
            onClick={() => ejecutar({ accion: "excluir", campaignId: campana.id, enrollmentIds: marcados }, "Participantes excluidos")}>
            Excluir seleccionados
          </button>
          <button type="button" className="btn-sm ghost" disabled={ocupado || marcados.length === 0}
            onClick={() => ejecutar({ accion: "restaurar", campaignId: campana.id, enrollmentIds: marcados }, "Participantes restaurados")}>
            Restaurar excluidos
          </button>
          <button type="button" className="btn-sm" disabled={!puedeEnviar} onClick={enviar}>
            {ocupado ? "Procesando…" : `Enviar ahora (${marcados.length})`}
          </button>
        </div>
      ) : (
        <p className="muted">Tienes acceso de solo lectura a esta campaña.</p>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th /><th>Nombre</th><th>WhatsApp</th><th>Estado de oferta</th><th>Estado comercial</th></tr>
          </thead>
          <tbody>
            {destinatarios.map((destinatario) => {
              // El backend vuelve a comprobarlo todo; esto solo evita ofrecer
              // una accion que se sabe que no va a proceder.
              const bloqueado = !puedeSeleccionarse(destinatario, canEdit);
              const etiqueta = etiquetaOferta(destinatario);
              return (
                <tr key={destinatario.enrollmentId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={marcados.includes(destinatario.enrollmentId)}
                      disabled={bloqueado || ocupado}
                      onChange={() => alternar(destinatario.enrollmentId)}
                      aria-label={`Seleccionar a ${destinatario.nombre}`}
                    />
                  </td>
                  <td><strong>{destinatario.nombre}</strong>{destinatario.motivo ? <div className="muted">{destinatario.motivo}</div> : null}</td>
                  <td>{destinatario.telefono ?? <span className="muted">Sin WhatsApp</span>}</td>
                  <td><span className={`pill ${etiqueta.clase}`}>{etiqueta.texto}</span></td>
                  <td className="muted">
                    {etiquetaComercial(destinatario.estadoComercial, campana.audienceMode)}
                    {destinatario.advertencia && !historica ? <div>{destinatario.advertencia}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {destinatarios.length === 0 ? (
        <p className="muted">Todavía no hay participantes sincronizados en esta campaña.</p>
      ) : null}
    </section>
  );
}
