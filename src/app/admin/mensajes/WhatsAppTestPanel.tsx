"use client";

import { useState } from "react";
import { useFeedback } from "../Feedback";

type Parametro = { posicion: string; variable: string; valorDeEjemplo: string };
type Preview = { plantilla: string; idioma: string; parametros: Parametro[]; mensaje: string; textoRegistrado: string };
type Respuesta = { ok?: boolean; sent?: boolean; preview?: Preview; message?: string; error?: string };

/**
 * Las doce del catalogo, en el orden del journey.
 *
 * Antes solo se exponian cinco, y las demas no habia forma de probarlas desde
 * el panel: habia que esperar a que un curso real las disparara. La oferta
 * institucional va la ultima y no forma parte del journey, pero se puede
 * comprobar igual, porque comparte adaptador y el mismo tipo de fallo por
 * contrato.
 */
const PLANTILLAS = [
  { key: "welcome", label: "1 · Bienvenida al inscribirse" },
  { key: "whatsapp_group", label: "2 · Grupo de WhatsApp" },
  { key: "reminder_24h", label: "3 · Recordatorio 24 horas antes" },
  { key: "reminder_2h", label: "4 · Acceso 2 horas antes" },
  { key: "reminder_15m", label: "5 · Acceso 15 minutos antes" },
  { key: "session_live", label: "6 · Sesión en vivo" },
  { key: "late_access", label: "7 · Acceso para rezagados" },
  { key: "thank_you", label: "8 · Fin de sesión" },
  { key: "course_complete", label: "9 · Curso completo" },
  { key: "course_follow_up", label: "10 · Seguimiento" },
  { key: "survey", label: "11 · Encuesta" },
  { key: "certification_offer", label: "12 · Oferta certificación institucional" },
] as const;

/**
 * Prueba de WhatsApp con vista previa.
 *
 * La vista previa es la parte util: enseña el numero exacto de parametros que
 * viajaria a Meta y en que orden. Un desajuste ahi es el fallo mas caro de este
 * canal, porque no se manifiesta hasta el primer envio real.
 *
 * El envio a un numero solo funciona si el canal esta en real. Estando en
 * simulacion, el servidor responde con la vista previa y lo explica, en lugar
 * de saltarse el interruptor.
 */
export function WhatsAppTestPanel() {
  const { toast, confirm } = useFeedback();
  const [plantilla, setPlantilla] = useState<string>(PLANTILLAS[0].key);
  const [numero, setNumero] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  /**
   * Al cambiar de plantilla se borra lo que habia en pantalla.
   *
   * Sin esto, la vista previa anterior seguia visible bajo el nombre de la
   * nueva: quien comprueba doce plantillas seguidas acababa dando por buena una
   * que no habia mirado.
   */
  function elegirPlantilla(clave: string) {
    setPlantilla(clave);
    setPreview(null);
    setAviso(null);
  }

  async function ejecutar(conNumero: boolean) {
    const destino = numero.trim();
    if (conNumero && !destino) {
      setAviso({ ok: false, texto: "Indica un número que controles para la prueba." });
      return;
    }
    if (conNumero) {
      const seguro = await confirm({
        title: "Enviar un WhatsApp de prueba",
        body: `Se enviará una sola plantilla a ${destino}. Úsalo solo con un número propio.`,
        confirmLabel: "Enviar prueba",
      });
      if (!seguro) return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/admin/whatsapp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, template: plantilla, ...(conNumero ? { to: destino } : {}) }),
      });
      const payload = (await response.json().catch(() => ({}))) as Respuesta;
      if (payload.preview) setPreview(payload.preview);
      const correcto = response.ok && payload.ok === true;
      setAviso({
        ok: correcto,
        texto: correcto ? payload.message ?? "Comprobación completada." : payload.error ?? "No se pudo completar la prueba.",
      });
      if (conNumero) {
        toast({
          tone: correcto ? "success" : "error",
          title: correcto ? "WhatsApp de prueba enviado" : "No se envió el WhatsApp de prueba",
          detail: correcto ? undefined : payload.error,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Probar una plantilla de WhatsApp</h2>
      <p className="muted">
        La vista previa arma el mensaje igual que lo haría el envío real y muestra los parámetros que viajarían a Meta,
        sin contactar con nadie. El envío a un número solo funciona cuando el canal está enviando de verdad.
      </p>
      <div className="form-row">
        <select value={plantilla} onChange={(event) => elegirPlantilla(event.target.value)} aria-label="Plantilla">
          {PLANTILLAS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <input
          type="tel"
          value={numero}
          onChange={(event) => setNumero(event.target.value)}
          placeholder="Número para la prueba (opcional)"
          aria-label="Número de WhatsApp para la prueba"
        />
        <button type="button" className="btn-sm ghost" disabled={busy} onClick={() => ejecutar(false)}>
          Ver vista previa
        </button>
        <button type="button" className="btn-sm" disabled={busy} onClick={() => ejecutar(true)}>
          Enviar prueba
        </button>
      </div>

      {preview ? (
        <div className="table-wrap">
          <p className="muted">
            <strong>{preview.plantilla}</strong> · idioma {preview.idioma} · {preview.parametros.length} parámetro(s)
          </p>
          <table className="data">
            <thead><tr><th>Posición</th><th>Variable</th><th>Valor de ejemplo</th></tr></thead>
            <tbody>
              {preview.parametros.map((parametro) => (
                <tr key={parametro.posicion}>
                  <td>{parametro.posicion}</td>
                  <td>{parametro.variable}</td>
                  <td className="muted">{parametro.valorDeEjemplo}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Así lo recibiría el contacto:</p>
          {/* Se respetan los saltos de linea: la plantilla registrada en Meta
              los tiene, y un texto reflowed no serviria para compararlo. */}
          <p className="template-preview">{preview.mensaje}</p>
        </div>
      ) : null}

      {aviso && <p className={`result-line ${aviso.ok ? "" : "is-error"}`} role="status">{aviso.texto}</p>}
    </section>
  );
}
