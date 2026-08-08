import { INTEGRATION_STATE_LABELS, integrationStatuses, type IntegrationState } from "@/lib/integration-status";

const pillClass: Record<IntegrationState, string> = {
  READY: "ok",
  SIMULATED: "info",
  PENDING_CONFIGURATION: "warn",
  PENDING_EXTERNAL_VERIFICATION: "warn",
  PENDING_PROVIDER_APPROVAL: "warn",
  PENDING_AD_ACCOUNT: "warn",
  NOT_READY: "info",
  ERROR: "err",
};

/**
 * Version para direccion: una linea por canal, sin vocabulario del sistema.
 *
 * El detalle tecnico (Login Kit, callbacks, tokens, nombres de variables) es
 * util para diagnosticar y completamente inutil para decidir. Quien dirige
 * necesita saber si puede publicar, no que le falta a la integracion por
 * dentro; eso vive en la vista tecnica.
 */
const RESUMEN_SIMPLE: Record<IntegrationState, string> = {
  READY: "Listo para publicar",
  SIMULATED: "En pruebas, todavía no publica",
  PENDING_CONFIGURATION: "Falta terminar de configurar",
  PENDING_EXTERNAL_VERIFICATION: "Esperando verificación externa",
  PENDING_PROVIDER_APPROVAL: "Esperando aprobación de la plataforma",
  PENDING_AD_ACCOUNT: "Falta la cuenta publicitaria",
  NOT_READY: "Todavía no disponible",
  ERROR: "Con un problema",
};

export function IntegrationStatusPanel({ only, technical = true }: { only?: string[]; technical?: boolean } = {}) {
  const statuses = integrationStatuses().filter((item) => !only || only.includes(item.key));

  if (!technical) {
    return (
      <section className="panel" aria-label="Estado de los canales">
        <h2>Canales</h2>
        <div className="channel-list">
          {statuses.map((status) => (
            <div className="channel-row" key={status.key}>
              <span className={`status-dot ${status.state === "READY" ? "is-done" : status.state === "ERROR" ? "is-problem" : "is-attention"}`} />
              <strong>{status.name.replace(/\s*\(.*\)$/, "")}</strong>
              <span className="channel-state">{RESUMEN_SIMPLE[status.state]}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Estado de las integraciones">
      <h2>Estado de las integraciones</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Integración</th><th>Estado</th><th>Detalle</th></tr>
          </thead>
          <tbody>
            {statuses.map((status) => (
              <tr key={status.key}>
                <td><strong>{status.name}</strong></td>
                <td><span className={`pill ${pillClass[status.state]}`}>{INTEGRATION_STATE_LABELS[status.state]}</span></td>
                <td>
                  {status.detail}
                  {status.nextStep && <div className="muted">{status.nextStep}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
