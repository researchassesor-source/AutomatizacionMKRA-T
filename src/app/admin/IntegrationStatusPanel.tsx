import { INTEGRATION_STATE_LABELS, integrationStatuses, type IntegrationState, type PublicacionesVerificadas } from "@/lib/integration-status";
import { prisma } from "@/lib/db";

const pillClass: Record<IntegrationState, string> = {
  READY: "ok",
  CONNECTED_UNVERIFIED: "info",
  SIMULATED: "info",
  PENDING_CONFIGURATION: "warn",
  PENDING_EXTERNAL_VERIFICATION: "warn",
  PENDING_PROVIDER_APPROVAL: "warn",
  PENDING_AD_ACCOUNT: "warn",
  NOT_READY: "info",
  ERROR: "err",
};

const SUMMARY: Record<IntegrationState, string> = {
  READY: "El canal ha completado una operación real verificada.",
  CONNECTED_UNVERIFIED: "La conexión está configurada y espera una validación completa.",
  SIMULATED: "Funciona de forma controlada sin contactar servicios externos.",
  PENDING_CONFIGURATION: "Falta completar una condición para poder operar.",
  PENDING_EXTERNAL_VERIFICATION: "La configuración local está lista y espera revisión externa.",
  PENDING_PROVIDER_APPROVAL: "El proveedor todavía debe completar su aprobación.",
  PENDING_AD_ACCOUNT: "Falta asignar la cuenta necesaria para este canal.",
  NOT_READY: "El canal todavía no dispone de una conexión operativa.",
  ERROR: "Existe una incidencia que requiere diagnóstico técnico.",
};

function safeTechnicalText(value: string): string {
  return value
    .replace(/(password|secret|token|authorization|cookie)\s*[:=]\s*\S+/gi, "$1: [oculto]")
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credenciales ocultas]@");
}

async function verifiedPublications(): Promise<PublicacionesVerificadas> {
  const networks = await prisma.socialPost.findMany({
    where: { status: "PUBLICADO", externalPostId: { not: null }, account: { platform: { in: ["FACEBOOK", "INSTAGRAM"] } } },
    select: { account: { select: { platform: true } } },
    distinct: ["accountId"],
  });
  const verified: PublicacionesVerificadas = {};
  for (const item of networks) {
    if (item.account.platform === "FACEBOOK" || item.account.platform === "INSTAGRAM") verified[item.account.platform] = true;
  }
  return verified;
}

export async function IntegrationStatusPanel({ only, technical = true }: { only?: string[]; technical?: boolean } = {}) {
  const statuses = integrationStatuses(await verifiedPublications()).filter((item) => !only || only.includes(item.key));

  if (!technical) {
    return (
      <section className="panel" aria-label="Estado de los canales">
        <h2>Canales</h2>
        <div className="channel-list">
          {statuses.map((status) => (
            <div className="channel-row" key={status.key}>
              <span className={`status-dot ${status.state === "READY" ? "is-done" : status.state === "ERROR" ? "is-problem" : "is-attention"}`} />
              <strong>{status.name.replace(/\s*\(.*\)$/, "")}</strong>
              <span className="channel-state">{INTEGRATION_STATE_LABELS[status.state]}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const operational = statuses.filter((status) => status.state === "READY").length;
  const configured = statuses.filter((status) => status.state === "CONNECTED_UNVERIFIED").length;
  const simulated = statuses.filter((status) => status.state === "SIMULATED").length;
  const attention = statuses.filter((status) => !["READY", "CONNECTED_UNVERIFIED", "SIMULATED", "ERROR"].includes(status.state)).length;
  const incidents = statuses.filter((status) => status.state === "ERROR").length;

  return (
    <section className="panel integration-status-panel" aria-label="Estado de las integraciones">
      <div className="panel-head"><div><h2>Integraciones</h2><p className="muted">Lectura actual basada en la configuración y el historial existente.</p></div></div>
      <fieldset className="integration-summary-grid"><legend className="sr-only">Resumen técnico</legend>
        <span><strong>{operational}</strong> operativas</span>
        <span><strong>{configured}</strong> configuradas</span>
        <span><strong>{simulated}</strong> en simulación</span>
        <span><strong>{attention}</strong> requieren atención</span>
        <span className={incidents > 0 ? "is-incident" : ""}><strong>{incidents}</strong> incidencias</span>
      </fieldset>
      <div className="integration-card-grid">
        {statuses.map((status) => (
          <article className={`integration-card is-${status.state.toLowerCase()}`} key={status.key}>
            <header><strong>{status.name}</strong><span className={`pill ${pillClass[status.state]}`}>{INTEGRATION_STATE_LABELS[status.state]}</span></header>
            <p>{SUMMARY[status.state]}</p>
            <details>
              <summary>Ver detalle técnico</summary>
              <div className="integration-technical-detail">
                <p>{safeTechnicalText(status.detail)}</p>
                {status.nextStep ? <p><strong>Siguiente paso:</strong> {safeTechnicalText(status.nextStep)}</p> : null}
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
