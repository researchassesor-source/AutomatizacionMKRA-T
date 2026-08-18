"use client";

import { useState } from "react";
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
};

type Enlaces = { whatsappGroupUrl: string | null; courseCompleteUrl: string | null; surveyUrl: string | null };

/** Pasos que no pueden salir sin su enlace configurado. */
const ENLACE_DE_PASO: Record<string, keyof Enlaces> = {
  whatsapp_group: "whatsappGroupUrl",
  course_complete: "courseCompleteUrl",
  course_follow_up: "courseCompleteUrl",
  survey: "surveyUrl",
};

const NOMBRE_ENLACE: Record<keyof Enlaces, string> = {
  whatsappGroupUrl: "Grupo de WhatsApp",
  courseCompleteUrl: "Curso completo",
  surveyUrl: "Encuesta final",
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

/**
 * Control operativo del recorrido del curso.
 *
 * Quien administra decide en los mismos terminos en los que piensa: este paso
 * se envia o no, y a que hora. No aparecen `ACTIVE`, `PAUSED` ni minutos de
 * desfase, porque para tomar esa decision no hacen falta y solo consiguen que
 * alguien no se atreva a tocarlo.
 */
export function CourseCommunicationsManager({
  courseId, canEdit, pasos, reglas, enlaces, cursoPausado,
}: {
  courseId: string;
  canEdit: boolean;
  pasos: Paso[];
  reglas: Regla[];
  enlaces: Enlaces;
  cursoPausado: boolean;
}) {
  const [estado, setEstado] = useState<Record<string, boolean>>(
    Object.fromEntries(pasos.map((p) => [p.planKey, p.active])),
  );
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [editandoEnlaces, setEditandoEnlaces] = useState(false);
  const [valores, setValores] = useState<Enlaces>(enlaces);

  async function alternar(planKey: string, activar: boolean) {
    if (!canEdit || ocupado) return;
    setOcupado(planKey);
    setAviso(null);
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/communications/${planKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: activar, confirm: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAviso({ ok: false, texto: json.error ?? "No se pudo guardar el cambio." });
        return;
      }
      setEstado((previo) => ({ ...previo, [planKey]: activar }));
      setAviso({ ok: true, texto: activar ? "Este paso volverá a enviarse." : "Este paso deja de enviarse." });
    } catch {
      setAviso({ ok: false, texto: "No se pudo guardar el cambio." });
    } finally {
      setOcupado(null);
    }
  }

  async function guardarEnlaces() {
    if (!canEdit || ocupado) return;
    setOcupado("enlaces");
    setAviso(null);
    try {
      const res = await fetch(`/api/admin/courses/${courseId}/communication-links`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valores),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAviso({ ok: false, texto: json.error ?? "Revisa las direcciones." });
        return;
      }
      setAviso({ ok: true, texto: "Enlaces guardados." });
      setEditandoEnlaces(false);
    } catch {
      setAviso({ ok: false, texto: "No se pudieron guardar los enlaces." });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className="panel">
      <h2>Qué recibe cada inscrito</h2>
      <p className="muted">
        El recorrido completo desde que alguien se inscribe hasta que termina el curso.
        {cursoPausado ? " Ahora mismo el curso está pausado, así que no sale ningún mensaje." : ""}
      </p>

      {/* ------------ enlaces ------------ */}
      <div className="comms-links">
        <h3>Enlaces del recorrido</h3>
        {(Object.keys(NOMBRE_ENLACE) as Array<keyof Enlaces>).map((campo) => (
          <p key={campo} className="muted">
            {NOMBRE_ENLACE[campo]}: {valores[campo] ? <span>Configurado</span> : <strong>Pendiente</strong>}
          </p>
        ))}
        {canEdit ? (
          <button type="button" className="btn-sm ghost" onClick={() => setEditandoEnlaces((v) => !v)} aria-expanded={editandoEnlaces}>
            {editandoEnlaces ? "Cerrar" : "Editar enlaces"}
          </button>
        ) : null}

        {editandoEnlaces ? (
          <div className="comms-links-form">
            {(Object.keys(NOMBRE_ENLACE) as Array<keyof Enlaces>).map((campo) => (
              <div className="form-row" key={campo}>
                <label htmlFor={`enlace-${campo}`}>{NOMBRE_ENLACE[campo]}</label>
                <input
                  id={`enlace-${campo}`}
                  type="url"
                  value={valores[campo] ?? ""}
                  placeholder="https://…"
                  onChange={(event) => setValores((v) => ({ ...v, [campo]: event.target.value }))}
                />
              </div>
            ))}
            <button type="button" className="btn-sm" disabled={ocupado === "enlaces"} onClick={() => void guardarEnlaces()}>
              {ocupado === "enlaces" ? "Guardando enlaces…" : "Guardar enlaces"}
            </button>
          </div>
        ) : null}
      </div>

      {/* ------------ pasos ------------ */}
      <ol className="comms-steps">
        {pasos.map((paso) => {
          const activo = estado[paso.planKey] ?? paso.active;
          const delPaso = reglas.filter((r) => r.planKey === paso.planKey);
          const campoEnlace = ENLACE_DE_PASO[paso.planKey];
          const faltaEnlace = campoEnlace ? !valores[campoEnlace] : false;
          const sinReglas = delPaso.length === 0;

          return (
            <li key={paso.planKey} className="comms-step">
              <div className="comms-step-main">
                <strong>{paso.title}</strong>
                <p className="muted">{paso.when} · {delPaso.map((r) => (r.channel === "EMAIL" ? "Correo" : "WhatsApp")).join(" y ") || "Sin canales"}</p>
                <p className="muted">{paso.detail}</p>
                {paso.scheduledAt ? <p className="muted">Próximo envío: {new Date(paso.scheduledAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil", dateStyle: "short", timeStyle: "short" })}</p> : null}
                {paso.blockedReason ? <p className="result-line is-error">{paso.blockedReason}</p> : null}
                {faltaEnlace ? (
                  <p className="result-line is-error">
                    Falta el enlace: {NOMBRE_ENLACE[campoEnlace]}{" "}
                    {canEdit ? <button type="button" className="btn-sm ghost" onClick={() => setEditandoEnlaces(true)}>Configurar</button> : null}
                  </p>
                ) : null}
              </div>

              <div className="comms-step-actions">
                <span className="muted">{sinReglas ? "No configurado" : activo ? "Enviar" : "No enviar"}</span>
                {canEdit && !sinReglas ? (
                  <button
                    type="button"
                    className={`btn-sm ${activo ? "" : "ghost"}`}
                    aria-pressed={activo}
                    aria-label={`${activo ? "Dejar de enviar" : "Enviar"}: ${paso.title}`}
                    disabled={ocupado === paso.planKey}
                    onClick={() => void alternar(paso.planKey, !activo)}
                  >
                    {ocupado === paso.planKey ? "Guardando…" : activo ? "No enviar" : "Enviar"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-sm ghost"
                  aria-label={`Editar: ${paso.title}`}
                  aria-expanded={editando === paso.planKey}
                  onClick={() => setEditando(editando === paso.planKey ? null : paso.planKey)}
                >
                  Editar
                </button>
              </div>

              {editando === paso.planKey ? (
                <div className="comms-step-editor">
                  {sinReglas ? (
                    <p className="muted">Este paso todavía no tiene una regla configurada. Aplica el plan estándar desde Automatizaciones.</p>
                  ) : (
                    delPaso.map((regla) => (
                      <ReglaEditor key={regla.id} regla={regla} canEdit={canEdit} onAviso={setAviso} />
                    ))
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {aviso ? <p className={`result-line ${aviso.ok ? "" : "is-error"}`} role="status">{aviso.texto}</p> : null}
    </section>
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
  onAviso: (aviso: { ok: boolean; texto: string }) => void;
}) {
  const inicial = aHumano(regla.offsetMinutes);
  const [cantidad, setCantidad] = useState(inicial.cantidad);
  const [unidad, setUnidad] = useState(inicial.unidad);
  const [subject, setSubject] = useState(regla.subject ?? "");
  const [body, setBody] = useState(regla.body);
  const [guardando, setGuardando] = useState(false);
  const esWhatsApp = regla.channel === "WHATSAPP";

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
