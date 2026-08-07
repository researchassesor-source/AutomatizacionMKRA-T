import { DEFAULT_GRAPH_API_VERSION } from "@/lib/social/meta-config";
import { isPreviewDeployment } from "@/lib/runtime-environment";
import { parseLiveFrom, type LiveWindow } from "@/lib/live-activation";

/**
 * Configuracion del canal de WhatsApp, deliberadamente separada del correo.
 *
 * El correo y WhatsApp compartian `MESSAGING_MODE`, de modo que no habia forma
 * de apagar uno sin tocar el otro. Con el correo ya operando en real eso es un
 * riesgo innecesario: cualquier maniobra sobre WhatsApp ponia en juego el canal
 * que si funciona. `WHATSAPP_MODE` existe para que ese acoplamiento desaparezca.
 *
 * Compatibilidad hacia atras: la variable no existia, asi que su ausencia debe
 * significar algo seguro. Significa `disabled`: el canal no envia nada y lo
 * dice. Heredar `MESSAGING_MODE` habria puesto WhatsApp en real el mismo dia
 * que se desplegara esto, sin que nadie lo pidiera.
 */
export const WHATSAPP_LIVE_FROM = "WHATSAPP_LIVE_FROM";

export type WhatsAppMode = "disabled" | "simulation" | "live";

export type EnvSource = Record<string, string | undefined>;

export type WhatsAppConfig = {
  mode: WhatsAppMode;
  phoneNumberId?: string;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  graphVersion: string;
};

function value(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Solo `live` y `simulation` se reconocen, sin distinguir mayusculas ni
 * espacios sobrantes. Cualquier otro valor cae en `disabled`: "true", "on" o
 * "activo" no pueden interpretarse como permiso para escribir a nadie.
 */
export function parseWhatsAppMode(raw: string | undefined): WhatsAppMode {
  const mode = raw?.trim().toLowerCase();
  if (mode === "live") return "live";
  if (mode === "simulation") return "simulation";
  return "disabled";
}

function normalizeVersion(raw: string | undefined): string {
  const candidate = value(raw);
  if (!candidate) return DEFAULT_GRAPH_API_VERSION;
  const normalized = candidate.startsWith("v") ? candidate : `v${candidate}`;
  return /^v\d+\.\d+$/.test(normalized) ? normalized : DEFAULT_GRAPH_API_VERSION;
}

export function resolveWhatsAppConfig(env: EnvSource = process.env): WhatsAppConfig {
  return {
    mode: parseWhatsAppMode(env.WHATSAPP_MODE),
    phoneNumberId: value(env.WHATSAPP_PHONE_NUMBER_ID),
    accessToken: value(env.WHATSAPP_ACCESS_TOKEN),
    appSecret: value(env.META_APP_SECRET),
    verifyToken: value(env.META_WEBHOOK_VERIFY_TOKEN),
    // Version propia de WhatsApp: subir la de Facebook/Instagram no debe
    // arrastrar este canal, ni al reves.
    graphVersion: normalizeVersion(env.WHATSAPP_GRAPH_API_VERSION),
  };
}

export function hasSendCredentials(config: WhatsAppConfig): boolean {
  return Boolean(config.phoneNumberId && config.accessToken);
}

/**
 * Ventana de activacion propia de WhatsApp, con la misma garantia que la del
 * correo: pasar a real no puede vaciar la cola atrasada sobre los contactos.
 */
export function resolveWhatsAppWindow(env: EnvSource = process.env): LiveWindow {
  const config = resolveWhatsAppConfig(env);
  if (config.mode === "disabled") {
    return {
      state: "blocked",
      errorCode: "WHATSAPP_DISABLED",
      error: "WhatsApp está deshabilitado (WHATSAPP_MODE no es 'simulation' ni 'live'). No se envía ni se simula nada.",
    };
  }
  // Preview y desarrollo nunca contactan a nadie, aunque el modo diga live.
  if (isPreviewDeployment(env) || env.NODE_ENV !== "production" || config.mode === "simulation") {
    return { state: "simulation" };
  }
  if (!hasSendCredentials(config)) {
    return {
      state: "blocked",
      errorCode: "WHATSAPP_CREDENTIALS_MISSING",
      error: "WHATSAPP_MODE=live pero faltan WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN. El envío queda bloqueado en lugar de fallar contacto a contacto.",
    };
  }
  const liveFrom = parseLiveFrom(env[WHATSAPP_LIVE_FROM]);
  if (!liveFrom) {
    return {
      state: "blocked",
      errorCode: env[WHATSAPP_LIVE_FROM]?.trim() ? "LIVE_FROM_INVALID" : "LIVE_FROM_MISSING",
      error: env[WHATSAPP_LIVE_FROM]?.trim()
        ? `${WHATSAPP_LIVE_FROM} no es una fecha ISO 8601 en UTC (ejemplo: 2026-08-08T18:00:00Z). El envío real queda bloqueado por seguridad.`
        : `Falta ${WHATSAPP_LIVE_FROM}. Para activar WhatsApp en real hay que declarar desde qué momento puede salir, así la cola atrasada nunca se dispara sola.`,
    };
  }
  return { state: "live", liveFrom };
}

/** Resumen para la interfaz. Nunca incluye token, secreto ni identificadores. */
export function describeWhatsAppConfig(env: EnvSource = process.env) {
  const config = resolveWhatsAppConfig(env);
  const window = resolveWhatsAppWindow(env);
  return {
    mode: config.mode,
    windowState: window.state,
    liveFrom: window.state === "live" ? window.liveFrom.toISOString() : null,
    blockedReason: window.state === "blocked" ? window.error : null,
    blockedCode: window.state === "blocked" ? window.errorCode : null,
    phoneNumberConfigured: Boolean(config.phoneNumberId),
    tokenConfigured: Boolean(config.accessToken),
    appSecretConfigured: Boolean(config.appSecret),
    verifyTokenConfigured: Boolean(config.verifyToken),
    webhookReady: Boolean(config.appSecret && config.verifyToken),
    graphVersion: config.graphVersion,
  };
}
