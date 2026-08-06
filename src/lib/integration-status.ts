import { describeEmailConfig, resolveEmailConfig } from "@/lib/email/config";
import {
  MESSAGING_LIVE_FROM,
  resolveMessagingWindow,
  resolveSocialWindow,
  SOCIAL_LIVE_FROM,
} from "@/lib/live-activation";
import { isMessagingSimulation } from "@/lib/nurture/engine";
import { describeMetaConfig, resolveMetaConfig } from "@/lib/social/meta-config";
import { isSocialSimulation } from "@/lib/social/orchestrator";

const guayaquil = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });

/**
 * Estado de cada integracion en lenguaje del administrador.
 *
 * Nunca expone tokens ni contraseñas: solo si estan configurados. Se usa en el
 * panel de Redes y en Mensajes para que quede claro que esta operativo y que
 * sigue pendiente.
 */
export type IntegrationState = "ACTIVA" | "SIMULACION" | "INCOMPLETA" | "PENDIENTE";

export type IntegrationStatus = {
  key: string;
  name: string;
  state: IntegrationState;
  detail: string;
  /** Accion concreta pendiente, si la hay. */
  nextStep: string | null;
};

function emailStatus(): IntegrationStatus {
  const config = describeEmailConfig(resolveEmailConfig());
  const simulation = isMessagingSimulation();
  const window = resolveMessagingWindow();
  if (window.state === "blocked") {
    return {
      key: "email",
      name: "Correo electrónico",
      state: "INCOMPLETA",
      detail: window.error,
      nextStep: `Define ${MESSAGING_LIVE_FROM} con una fecha ISO 8601 en UTC. Hasta entonces no se envía ningún correo.`,
    };
  }
  if (config.provider === "none") {
    return {
      key: "email",
      name: "Correo electrónico",
      state: "INCOMPLETA",
      detail: config.reason ?? "Falta configurar el correo saliente.",
      nextStep: "Agrega EMAIL_FROM, SMTP_HOST, SMTP_USER y SMTP_PASSWORD en Vercel.",
    };
  }
  if (simulation) {
    return {
      key: "email",
      name: "Correo electrónico",
      state: "SIMULACION",
      detail: `Configurado (${config.from}), pero el entorno actual no envía correos reales.`,
      nextStep: "Para enviar de verdad, MESSAGING_MODE debe ser live en Producción.",
    };
  }
  return {
    key: "email",
    name: "Correo electrónico",
    state: "ACTIVA",
    detail: `Envío real por ${config.host}:${config.port} como ${config.from}.`,
    nextStep: window.state === "live"
      ? `Solo salen mensajes programados desde el ${guayaquil.format(window.liveFrom)}. Lo anterior queda visible pero no se envía.`
      : null,
  };
}

function metaStatus(platform: "FACEBOOK" | "INSTAGRAM"): IntegrationStatus {
  const config = describeMetaConfig(resolveMetaConfig());
  const isFacebook = platform === "FACEBOOK";
  const name = isFacebook ? "Facebook (publicación orgánica)" : "Instagram (publicación orgánica)";
  const identifier = isFacebook ? config.pageId : config.instagramAccountId;
  const window = resolveSocialWindow();
  if (window.state === "blocked") {
    return {
      key: platform.toLowerCase(),
      name,
      state: "INCOMPLETA",
      detail: window.error,
      nextStep: `Define ${SOCIAL_LIVE_FROM} con una fecha ISO 8601 en UTC. Hasta entonces no se publica nada.`,
    };
  }
  if (!config.tokenConfigured || !identifier) {
    return {
      key: platform.toLowerCase(),
      name,
      state: "INCOMPLETA",
      detail: !config.tokenConfigured
        ? "Falta el token del usuario del sistema de Meta."
        : `Falta ${isFacebook ? "META_PAGE_ID" : "META_INSTAGRAM_ACCOUNT_ID"}.`,
      nextStep: "Completa las variables de Meta en Vercel y vuelve a comprobar el estado.",
    };
  }
  if (isSocialSimulation()) {
    return {
      key: platform.toLowerCase(),
      name,
      state: "SIMULACION",
      detail: `Credenciales presentes (Graph ${config.graphVersion}), pero el entorno actual no publica contenido real.`,
      nextStep: "Para publicar de verdad, SOCIAL_MODE debe ser live en Producción.",
    };
  }
  return {
    key: platform.toLowerCase(),
    name,
    state: "ACTIVA",
    detail: `Publicación real habilitada con Graph ${config.graphVersion} (${isFacebook ? "página" : "cuenta"} ${identifier}).`,
    nextStep: window.state === "live"
      ? `Solo se publica lo programado desde el ${guayaquil.format(window.liveFrom)}. Lo anterior queda visible pero no sale.`
      : null,
  };
}

function tiktokStatus(): IntegrationStatus {
  const configured = Boolean(process.env.TIKTOK_CLIENT_KEY?.trim() && process.env.TIKTOK_CLIENT_SECRET?.trim());
  return {
    key: "tiktok",
    name: "TikTok",
    state: configured ? "SIMULACION" : "PENDIENTE",
    detail: configured
      ? "Aplicación y Sandbox configurados. La publicación desde el CRM sigue en preparación."
      : "Configuración externa lista (Sandbox), sin credenciales cargadas en el CRM.",
    nextStep: "Prioridad posterior al correo y a Meta. No enviar a revisión hasta probar el flujo completo.",
  };
}

function whatsappStatus(): IntegrationStatus {
  return {
    key: "whatsapp",
    name: "WhatsApp",
    state: "PENDIENTE",
    detail: "WhatsApp pendiente de conexión. El número aparece sin conexión y la cuenta no admite más socios asignados.",
    nextStep: "No bloquea inscripciones ni correos. Los mensajes de este canal quedan pendientes, nunca marcados como enviados.",
  };
}

function adsStatus(): IntegrationStatus {
  const config = describeMetaConfig(resolveMetaConfig());
  return {
    key: "meta_ads",
    name: "Campañas pagadas de Meta",
    state: config.adAccountConfigured ? "SIMULACION" : "PENDIENTE",
    detail: config.adAccountConfigured
      ? "Cuenta publicitaria declarada, sin automatización de anuncios habilitada."
      : "Cuenta publicitaria no asignada al portafolio comercial.",
    nextStep: "Agregar una cuenta publicitaria en Meta Business antes de crear campañas pagadas. La publicación orgánica no depende de esto.",
  };
}

function cronStatus(): IntegrationStatus {
  const configured = Boolean(process.env.CRON_SECRET?.trim());
  return {
    key: "cron",
    name: "Procesos programados",
    state: configured ? "ACTIVA" : "INCOMPLETA",
    detail: configured
      ? "Los endpoints de automatización exigen el secreto compartido."
      : "Sin CRON_SECRET los procesos programados no pueden autenticarse en Producción.",
    nextStep: configured ? null : "Define CRON_SECRET en Vercel y en el secreto del repositorio.",
  };
}

export function integrationStatuses(): IntegrationStatus[] {
  return [
    emailStatus(),
    metaStatus("FACEBOOK"),
    metaStatus("INSTAGRAM"),
    tiktokStatus(),
    whatsappStatus(),
    adsStatus(),
    cronStatus(),
  ];
}

export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  ACTIVA: "Activa",
  SIMULACION: "Simulación segura",
  INCOMPLETA: "Configuración incompleta",
  PENDIENTE: "Pendiente",
};
