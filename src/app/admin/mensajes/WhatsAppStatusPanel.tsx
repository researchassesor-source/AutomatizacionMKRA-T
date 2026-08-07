import { describeWhatsAppConfig } from "@/lib/whatsapp/config";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";

type Row = { label: string; ok: boolean; detail: string };

/**
 * Estado honesto del canal de WhatsApp.
 *
 * Solo muestra presencia o ausencia. Ningun token, secreto ni identificador
 * aparece aqui, ni completo ni parcial: un panel administrativo no es lugar
 * para credenciales, y un fragmento tampoco es inofensivo.
 */
export function WhatsAppStatusPanel({ rulesWithoutTemplate, queued }: { rulesWithoutTemplate: number; queued: number }) {
  const wa = describeWhatsAppConfig();
  const expectedTemplates = Object.values(WHATSAPP_TEMPLATES).length;

  const estado = wa.mode === "disabled"
    ? { texto: "Deshabilitado", clase: "warn", explicacion: "WHATSAPP_MODE no está definido como 'simulation' ni 'live'. El canal no envía ni simula. El correo no se ve afectado." }
    : wa.windowState === "blocked"
      ? { texto: "Bloqueado", clase: "err", explicacion: wa.blockedReason ?? "El canal está bloqueado." }
      : wa.windowState === "live"
        ? { texto: "Envío real", clase: "ok", explicacion: `Solo pueden salir los mensajes programados a partir de ${wa.liveFrom}.` }
        : { texto: "Simulación", clase: "info", explicacion: "Los mensajes se registran como SIMULADO. No se contacta a nadie ni se llama a Meta." };

  const filas: Row[] = [
    { label: "Número (Phone Number ID)", ok: wa.phoneNumberConfigured, detail: wa.phoneNumberConfigured ? "Configurado" : "Falta WHATSAPP_PHONE_NUMBER_ID" },
    { label: "Token de acceso", ok: wa.tokenConfigured, detail: wa.tokenConfigured ? "Configurado" : "Falta WHATSAPP_ACCESS_TOKEN" },
    { label: "App Secret (firma del webhook)", ok: wa.appSecretConfigured, detail: wa.appSecretConfigured ? "Configurado" : "Falta META_APP_SECRET" },
    { label: "Verify token (alta del webhook)", ok: wa.verifyTokenConfigured, detail: wa.verifyTokenConfigured ? "Configurado" : "Falta META_WEBHOOK_VERIFY_TOKEN" },
    {
      label: "Webhook listo para dar de alta",
      ok: wa.webhookReady,
      detail: wa.webhookReady
        ? "La ruta puede verificarse y comprobar firmas."
        : "Sin App Secret y verify token, los mensajes se quedan en ACEPTADO y nunca llegan a ENTREGADO ni LEÍDO.",
    },
    {
      label: `Plantillas declaradas en el código (${expectedTemplates})`,
      ok: rulesWithoutTemplate === 0,
      detail: rulesWithoutTemplate === 0
        ? "Todas las reglas de WhatsApp declaran su plantilla."
        : `${rulesWithoutTemplate} regla(s) sin plantilla: sus mensajes se omiten en lugar de salir como texto libre.`,
    },
  ];

  return (
    <section className="panel">
      <h2>Estado de WhatsApp</h2>
      <p className="muted">
        Estado del canal: <span className={`pill ${estado.clase}`}>{estado.texto}</span> · Graph {wa.graphVersion}
      </p>
      <p className="muted">{estado.explicacion}</p>
      {queued > 0 && wa.mode === "disabled" ? (
        <p className="muted">
          <strong>{queued}</strong> mensaje(s) de WhatsApp esperan en cola con el canal apagado. Al activarlo solo saldrán los
          programados a partir de la fecha de activación.
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Componente</th><th>Estado</th><th>Detalle</th></tr></thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.label}>
                <td>{fila.label}</td>
                <td><span className={`pill ${fila.ok ? "ok" : "warn"}`}>{fila.ok ? "Listo" : "Pendiente"}</span></td>
                <td className="muted">{fila.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
