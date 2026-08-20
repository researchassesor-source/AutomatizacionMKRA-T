"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VARIABLES_DISPONIBLES } from "@/lib/template-variables";

type Regla = {
  id: string;
  planKey: string | null;
  channel: "EMAIL" | "WHATSAPP";
  status: string;
  trigger: "ON_REGISTRATION" | "BEFORE_COURSE" | "AFTER_COURSE";
  offsetMinutes: number;
  subject: string | null;
  body: string;
  waTemplateName: string | null;
};

type Paso = {
  planKey: string;
  title: string;
  when: string;
  detail: string;
  channels: Array<"EMAIL" | "WHATSAPP">;
  scheduledAt: string | null;
  active: boolean;
  blockedReason: string | null;
  /** Plan estandar de este paso, para configurar sin preguntar de mas. */
  defaultTrigger: Regla["trigger"];
  defaultOffsetMinutes: number;
  availableChannels: Array<"EMAIL" | "WHATSAPP">;
};

type Enlaces = { whatsappGroupUrl: string | null; courseCompleteUrl: string | null; surveyUrl: string | null };

type Oferta = {
  /** Campaña automática activa (SCHEDULED/RUNNING/COMPLETED). */
  seleccionada: boolean;
  /** Ya se envió: no se puede volver a activar desde aquí. */
  enviada: boolean;
  automaticScheduledAt: string | null;
  url: string | null;
  precio: number | null;
  delayHoras: number;
};

/** Pasos que no pueden salir sin su enlace configurado. */
const ENLACE_DE_PASO: Record<string, keyof Enlaces> = {
  whatsapp_group: "whatsappGroupUrl",
  course_complete: "courseCompleteUrl",
  course_follow_up: "courseCompleteUrl",
  survey: "surveyUrl",
};

const RELACION: Record<Regla["trigger"], string> = {
  ON_REGISTRATION: "después de registrarse",
  BEFORE_COURSE: "antes de la sesión",
  AFTER_COURSE: "después de la sesión",
};

/** Minutos a cantidad + unidad, para no hablarle al usuario en minutos. */
function aHumano(minutos: number): { cantidad: number; unidad: "minutos" | "horas" | "dias" } {
  if (minutos > 0 && minutos % 1440 === 0) return { cantidad: minutos / 1440, unidad: "dias" };
  if (minutos > 0 && minutos % 60 === 0) return { cantidad: minutos / 60, unidad: "horas" };
  return { cantidad: minutos, unidad: "minutos" };
}

function aMinutos(cantidad: number, unidad: "minutos" | "horas" | "dias"): number {
  const factor = unidad === "dias" ? 1440 : unidad === "horas" ? 60 : 1;
  return Math.max(0, Math.round(cantidad * factor));
}

export function describirMomento(regla: Pick<Regla, "trigger" | "offsetMinutes">): string {
  const { cantidad, unidad } = aHumano(regla.offsetMinutes);
  if (regla.offsetMinutes === 0) {
    return regla.trigger === "ON_REGISTRATION" ? "Al inscribirse" : "Justo al empezar la sesión";
  }
  const nombre = unidad === "dias" ? (cantidad === 1 ? "día" : "días") : unidad === "horas" ? (cantidad === 1 ? "hora" : "horas") : "minutos";
  return `${cantidad} ${nombre} ${RELACION[regla.trigger]}`;
}

type Aviso = { ok: boolean; texto: string };

/**
 * Control operativo del recorrido del curso (secciones N/O/P/Q del release
 * de estabilización).
 *
 * Dos bloques: los datos que alimentan los mensajes (enlaces + oferta), y
 * las 12 tarjetas del recorrido -las 11 reglas canónicas más la oferta
 * institucional, en la misma cuadrícula-. Nada de aquí muestra planKey,
 * ACTIVE/PAUSED, trigger ni offset: quien administra decide en los mismos
 * términos en los que piensa, "esto se envía o no y cuándo".
 */
export function CourseCommunicationsManager({
  courseId, canEdit, pasos, reglas, enlaces, cursoPausado, oferta,
}: {
  courseId: string;
  canEdit: boolean;
  pasos: Paso[];
  reglas: Regla[];
  enlaces: Enlaces;
  cursoPausado: boolean;
  oferta: Oferta;
}) {
  const [estado, setEstado] = useState<Record<string, boolean>>(
    Object.fromEntries(pasos.map((p) => [p.planKey, p.active])),
  );
  const [ofertaSeleccionada, setOfertaSeleccionada] = useState(oferta.seleccionada);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const router = useRouter();

  async function alternarPaso(paso: Paso, sinReglas: boolean) {
    if (!canEdit || ocupado) return;
    setOcupado(paso.planKey);
    setAviso(null);
    try {
      if (sinReglas) {
        // Primera selección: se configura con el plan estándar y los canales
        // disponibles, sin pedir de más. Ajustar el detalle es "Editar", aparte.
        const res = await fetch(`/api/admin/courses/${courseId}/communications/${paso.planKey}/configure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channels: paso.availableChannels, offsetMinutes: paso.defaultOffsetMinutes, confirm: true }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          setAviso({ ok: false, texto: json?.error ?? "No se pudo activar este mensaje." });
          return;
        }
        setAviso({ ok: true, texto: "Este mensaje se enviará." });
        router.refresh();
        return;
      }
      const activo = estado[paso.planKey] ?? paso.active;
      const res = await fetch(`/api/admin/courses/${courseId}/communications/${paso.planKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !activo, confirm: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAviso({ ok: false, texto: json.error ?? "No se pudo guardar el cambio." });
        return;
      }
      setEstado((previo) => ({ ...previo, [paso.planKey]: !activo }));
      setAviso({ ok: true, texto: !activo ? "Este mensaje se enviará." : "Este mensaje deja de enviarse." });
    } catch {
      setAviso({ ok: false, texto: "No se pudo guardar el cambio." });
    } finally {
      setOcupado(null);
    }
  }

  async function alternarOferta() {
    if (!canEdit || ocupado || oferta.enviada) return;
    setOcupado("oferta_institucional");
    setAviso(null);
    try {
      const res = await fetch("/api/admin/commerce/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ofertaSeleccionada ? { accion: "detener", courseId } : { accion: "activar", courseId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setAviso({ ok: false, texto: json?.error ?? "No se pudo guardar el cambio." });
        return;
      }
      setOfertaSeleccionada((previo) => !previo);
      setAviso({ ok: true, texto: !ofertaSeleccionada ? "La oferta institucional se enviará." : "La oferta institucional deja de enviarse." });
      router.refresh();
    } catch {
      setAviso({ ok: false, texto: "No se pudo guardar el cambio." });
    } finally {
      setOcupado(null);
    }
  }

  const ofertaIncompleta = !oferta.url || oferta.precio === null;
  const tarjetaOferta: TarjetaModelo = {
    key: "oferta_institucional",
    title: "Oferta institucional",
    subtitle: oferta.enviada
      ? "Ya se envió"
      : ofertaSeleccionada && oferta.automaticScheduledAt
        ? `Se enviará el ${new Date(oferta.automaticScheduledAt).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil", day: "numeric", month: "short" })}`
        : "Después del recorrido de 11 mensajes",
    estado: oferta.enviada ? "enviado" : ofertaSeleccionada ? (ofertaIncompleta ? "incompleto" : "seleccionado") : "deseleccionado",
    motivoIncompleto: ofertaIncompleta ? "Falta configurar la URL o el precio de la oferta." : null,
    ocupado: ocupado === "oferta_institucional",
    onClick: oferta.enviada ? undefined : () => void alternarOferta(),
    onEditar: undefined,
  };

  return (
    <>
      <section className="panel">
        <h2>Qué recibe cada inscrito</h2>
        <p className="muted">
          El recorrido completo desde que alguien se inscribe hasta que termina el curso.
          {cursoPausado ? " Ahora mismo el curso está pausado, así que no sale ningún mensaje." : ""}
        </p>

        <DatosParaLosMensajes courseId={courseId} canEdit={canEdit} enlaces={enlaces} oferta={oferta} onAviso={setAviso} />

        <h3 className="comms-cards-titulo">Mensajes de este curso</h3>
        <div className="comms-cards">
          {pasos.map((paso) => {
            const delPaso = reglas.filter((r) => r.planKey === paso.planKey);
            const sinReglas = delPaso.length === 0;
            const campoEnlace = ENLACE_DE_PASO[paso.planKey];
            const faltaEnlace = campoEnlace ? !enlaces[campoEnlace] : false;
            const activo = estado[paso.planKey] ?? paso.active;
            const motivoIncompleto = paso.blockedReason ?? (faltaEnlace ? "Falta configurar un enlace en Datos para los mensajes." : null);

            const modelo: TarjetaModelo = {
              key: paso.planKey,
              title: paso.title,
              subtitle: paso.scheduledAt
                ? `Próximo envío: ${new Date(paso.scheduledAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" })}`
                : paso.when,
              estado: activo ? (motivoIncompleto ? "incompleto" : "seleccionado") : "deseleccionado",
              motivoIncompleto: activo ? motivoIncompleto : null,
              ocupado: ocupado === paso.planKey,
              onClick: () => void alternarPaso(paso, sinReglas),
              onEditar: sinReglas ? undefined : () => setEditando(paso.planKey),
            };
            return <TarjetaMensaje key={paso.planKey} modelo={modelo} canEdit={canEdit} />;
          })}
          <TarjetaMensaje modelo={tarjetaOferta} canEdit={canEdit} />
        </div>

        {aviso ? <p className={`result-line ${aviso.ok ? "" : "is-error"}`} role="status">{aviso.texto}</p> : null}
      </section>

      {editando ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="editar-paso-titulo">
            <h2 id="editar-paso-titulo">Editar: {pasos.find((p) => p.planKey === editando)?.title}</h2>
            {reglas.filter((r) => r.planKey === editando).map((regla) => (
              <ReglaEditor key={regla.id} regla={regla} canEdit={canEdit} onAviso={setAviso} />
            ))}
            <div className="dialog-actions">
              <button type="button" className="btn-sm ghost" onClick={() => setEditando(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

type TarjetaEstado = "seleccionado" | "deseleccionado" | "incompleto" | "enviado";

type TarjetaModelo = {
  key: string;
  title: string;
  subtitle: string;
  estado: TarjetaEstado;
  motivoIncompleto: string | null;
  ocupado: boolean;
  onClick: (() => void) | undefined;
  onEditar: (() => void) | undefined;
};

const ETIQUETA_ESTADO: Record<TarjetaEstado, string> = {
  seleccionado: "Se enviará",
  deseleccionado: "No se enviará",
  incompleto: "Falta configurar",
  enviado: "Ya se envió",
};

/**
 * Una de las 12 tarjetas. Azul = se enviará, gris = no se enviará, ámbar =
 * seleccionado pero le falta algo. Nunca muestra planKey, ACTIVE/PAUSED,
 * trigger, offset ni "Sin canales": si algo falta, lo dice en una frase.
 */
function TarjetaMensaje({ modelo, canEdit }: { modelo: TarjetaModelo; canEdit: boolean }) {
  const clases = ["comms-card", `is-${modelo.estado}`, modelo.ocupado ? "is-ocupado" : ""].filter(Boolean).join(" ");
  return (
    <div className={clases}>
      <button
        type="button"
        className="comms-card-toggle"
        disabled={!canEdit || modelo.ocupado || !modelo.onClick}
        aria-pressed={modelo.estado === "seleccionado" || modelo.estado === "incompleto" || modelo.estado === "enviado"}
        aria-label={`${modelo.title}: ${ETIQUETA_ESTADO[modelo.estado]}`}
        onClick={modelo.onClick}
      >
        <span className="comms-card-check" aria-hidden="true">{modelo.estado === "deseleccionado" ? "" : "✓"}</span>
        <span className="comms-card-body">
          <strong>{modelo.title}</strong>
          <span className="comms-card-estado">{modelo.ocupado ? "Guardando…" : ETIQUETA_ESTADO[modelo.estado]}</span>
          <span className="comms-card-subtitle">{modelo.motivoIncompleto ?? modelo.subtitle}</span>
        </span>
      </button>
      {canEdit && modelo.onEditar ? (
        <button type="button" className="comms-card-editar" aria-label={`Editar: ${modelo.title}`} onClick={modelo.onEditar}>
          Editar
        </button>
      ) : null}
    </div>
  );
}

/**
 * BLOQUE 1: DATOS PARA LOS MENSAJES.
 *
 * Cuatro filas, cada una con su propio modal compacto -no un formulario
 * gigante compartido-. Guardar llama a la API segura de cada dato y ese
 * mismo endpoint ya se encarga de proteger y reprogramar lo que dependía
 * de él.
 */
function DatosParaLosMensajes({
  courseId, canEdit, enlaces, oferta, onAviso,
}: {
  courseId: string;
  canEdit: boolean;
  enlaces: Enlaces;
  oferta: Oferta;
  onAviso: (aviso: Aviso) => void;
}) {
  const [modal, setModal] = useState<null | "whatsappGroupUrl" | "courseCompleteUrl" | "surveyUrl" | "oferta">(null);

  const filas: Array<{ campo: "whatsappGroupUrl" | "courseCompleteUrl" | "surveyUrl" | "oferta"; nombre: string; configurado: boolean }> = [
    { campo: "whatsappGroupUrl", nombre: "Grupo WhatsApp", configurado: Boolean(enlaces.whatsappGroupUrl) },
    { campo: "courseCompleteUrl", nombre: "Curso completo", configurado: Boolean(enlaces.courseCompleteUrl) },
    { campo: "surveyUrl", nombre: "Encuesta final", configurado: Boolean(enlaces.surveyUrl) },
    { campo: "oferta", nombre: "Oferta institucional", configurado: Boolean(oferta.url) && oferta.precio !== null },
  ];

  return (
    <div className="comms-datos">
      <h3>Datos para los mensajes</h3>
      <table className="data comms-datos-tabla">
        <tbody>
          {filas.map((fila) => (
            <tr key={fila.campo}>
              <td>{fila.nombre}</td>
              <td><span className={fila.configurado ? "pill ok" : "pill"}>{fila.configurado ? "Configurado" : "Pendiente"}</span></td>
              <td>{canEdit ? <button type="button" className="btn-sm ghost" onClick={() => setModal(fila.campo)}>Configurar</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {modal && modal !== "oferta" ? (
        <EnlaceModal courseId={courseId} campo={modal} valorActual={enlaces[modal] ?? ""} onClose={() => setModal(null)} onAviso={onAviso} />
      ) : null}
      {modal === "oferta" ? (
        <OfertaModal courseId={courseId} oferta={oferta} onClose={() => setModal(null)} onAviso={onAviso} />
      ) : null}
    </div>
  );
}

const NOMBRE_ENLACE: Record<"whatsappGroupUrl" | "courseCompleteUrl" | "surveyUrl", string> = {
  whatsappGroupUrl: "Grupo WhatsApp",
  courseCompleteUrl: "Curso completo",
  surveyUrl: "Encuesta final",
};

function EnlaceModal({
  courseId, campo, valorActual, onClose, onAviso,
}: {
  courseId: string;
  campo: "whatsappGroupUrl" | "courseCompleteUrl" | "surveyUrl";
  valorActual: string;
  onClose: () => void;
  onAviso: (aviso: Aviso) => void;
}) {
  const [valor, setValor] = useState(valorActual);
  const [guardando, setGuardando] = useState(false);
  const router = useRouter();

  async function guardar() {
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/communication-links`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: valor, confirm: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        onAviso({ ok: false, texto: json?.error ?? "Revisa la dirección." });
        return;
      }
      onAviso({ ok: true, texto: "Guardado." });
      onClose();
      router.refresh();
    } catch {
      onAviso({ ok: false, texto: "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="enlace-modal-titulo">
        <h2 id="enlace-modal-titulo">{NOMBRE_ENLACE[campo]}</h2>
        <label className="field">
          <span>Dirección web</span>
          <input type="url" value={valor} placeholder="https://…" disabled={guardando} onChange={(event) => setValor(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn-sm ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn-sm" onClick={() => void guardar()} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

function OfertaModal({
  courseId, oferta, onClose, onAviso,
}: {
  courseId: string;
  oferta: Oferta;
  onClose: () => void;
  onAviso: (aviso: Aviso) => void;
}) {
  const [url, setUrl] = useState(oferta.url ?? "");
  const [precio, setPrecio] = useState(oferta.precio !== null ? String(oferta.precio) : "");
  const [horas, setHoras] = useState(oferta.delayHoras);
  const [guardando, setGuardando] = useState(false);
  const router = useRouter();

  async function guardar() {
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/institutional-offer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionalOfferUrl: url, institutionalOfferPrice: precio, institutionalOfferDelayHours: horas, confirm: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        onAviso({ ok: false, texto: json?.error ?? "Revisa los datos de la oferta." });
        return;
      }
      onAviso({ ok: true, texto: "Guardado." });
      onClose();
      router.refresh();
    } catch {
      onAviso({ ok: false, texto: "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="oferta-modal-titulo">
        <h2 id="oferta-modal-titulo">Oferta institucional</h2>
        <label className="field">
          <span>Dirección web de la oferta</span>
          <input type="url" value={url} placeholder="https://…" disabled={guardando} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="field">
          <span>Precio (USD)</span>
          <input type="number" min={0} step="0.01" value={precio} disabled={guardando} onChange={(event) => setPrecio(event.target.value)} />
        </label>
        <label className="field">
          <span>Horas después de terminar el curso</span>
          <input type="number" min={0} value={horas} disabled={guardando} onChange={(event) => setHoras(Number(event.target.value))} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn-sm ghost" onClick={onClose} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn-sm" onClick={() => void guardar()} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editor de una regla concreta.
 *
 * El correo se envia tal cual, asi que su asunto y su texto se editan de
 * verdad. El WhatsApp sale por una plantilla aprobada en Meta: cambiar aqui su
 * contenido no cambiaria lo que recibe el contacto, y un cuadro de texto
 * editable haria creer justo lo contrario. Por eso se muestra en solo lectura.
 */
function ReglaEditor({
  regla, canEdit, onAviso,
}: {
  regla: Regla;
  canEdit: boolean;
  onAviso: (aviso: Aviso) => void;
}) {
  const inicial = aHumano(regla.offsetMinutes);
  const [cantidad, setCantidad] = useState(inicial.cantidad);
  const [unidad, setUnidad] = useState(inicial.unidad);
  const [subject, setSubject] = useState(regla.subject ?? "");
  const [body, setBody] = useState(regla.body);
  const [guardando, setGuardando] = useState(false);
  const esWhatsApp = regla.channel === "WHATSAPP";
  const router = useRouter();

  async function guardar() {
    if (!canEdit || guardando) return;
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/automations/${regla.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          offsetMinutes: aMinutos(cantidad, unidad),
          // El contenido de WhatsApp no viaja: lo gobierna la plantilla de Meta.
          ...(esWhatsApp ? {} : { subject, body }),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        onAviso({ ok: false, texto: json?.error ?? "No se pudo guardar." });
        return;
      }
      onAviso({ ok: true, texto: "Cambios guardados." });
      // describirMomento(regla) y paso.scheduledAt vienen del servidor: sin
      // esto la pantalla seguiria mostrando el timing viejo tras guardar.
      router.refresh();
    } catch {
      onAviso({ ok: false, texto: "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="comms-rule">
      <p><strong>{esWhatsApp ? "WhatsApp" : "Correo"}</strong> · {describirMomento(regla)}</p>

      <div className="form-row">
        <label htmlFor={`cant-${regla.id}`}>Cuándo</label>
        <input
          id={`cant-${regla.id}`}
          type="number"
          min={0}
          value={cantidad}
          disabled={!canEdit}
          onChange={(event) => setCantidad(Number(event.target.value))}
        />
        <label className="sr-only" htmlFor={`uni-${regla.id}`}>Unidad</label>
        <select id={`uni-${regla.id}`} value={unidad} disabled={!canEdit} onChange={(event) => setUnidad(event.target.value as typeof unidad)}>
          <option value="minutos">minutos</option>
          <option value="horas">horas</option>
          <option value="dias">días</option>
        </select>
        {/* La relación la fija el disparador: no se puede elegir una imposible. */}
        <span className="muted">{RELACION[regla.trigger]}</span>
      </div>

      {esWhatsApp ? (
        <>
          <p className="muted">Plantilla: {regla.waTemplateName ?? "sin plantilla"}</p>
          <p className="muted">Contenido aprobado en Meta. Se puede cambiar cuándo se envía, no lo que dice.</p>
        </>
      ) : (
        <>
          <div className="form-row">
            <label htmlFor={`asunto-${regla.id}`}>Asunto</label>
            <input id={`asunto-${regla.id}`} value={subject} disabled={!canEdit} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <label htmlFor={`cuerpo-${regla.id}`}>Contenido</label>
          <textarea id={`cuerpo-${regla.id}`} value={body} rows={6} disabled={!canEdit} onChange={(event) => setBody(event.target.value)} />
          <p className="muted">Variables: {VARIABLES_DISPONIBLES.map((v) => `{{${v.nombre}}}`).join(" ")}</p>
        </>
      )}

      {canEdit ? (
        <button type="button" className="btn-sm" disabled={guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando cambios…" : "Guardar cambios"}
        </button>
      ) : null}
    </div>
  );
}
