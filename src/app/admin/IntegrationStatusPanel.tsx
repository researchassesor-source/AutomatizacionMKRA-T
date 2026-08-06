import { INTEGRATION_STATE_LABELS, integrationStatuses, type IntegrationState } from "@/lib/integration-status";

const pillClass: Record<IntegrationState, string> = {
  ACTIVA: "ok",
  SIMULACION: "info",
  INCOMPLETA: "err",
  PENDIENTE: "warn",
};

/**
 * Estado de las integraciones en lenguaje del administrador. No muestra tokens
 * ni contraseñas: solo si están configurados y qué falta por hacer.
 */
export function IntegrationStatusPanel({ only }: { only?: string[] } = {}) {
  const statuses = integrationStatuses().filter((item) => !only || only.includes(item.key));
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
