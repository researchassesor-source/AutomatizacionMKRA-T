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
import { describeWhatsAppConfig } from "@/lib/whatsapp/config";

const guayaquil = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });

/**
 * Estado de cada integracion en lenguaje del administrador.
 *
 * Nunca expone tokens ni contraseñas: solo si estan configurados. Se usa en el
 * panel de Redes y en Mensajes para que quede claro que esta operativo y que
 * sigue pendiente.
 */
export type IntegrationState =
  | "READY"
  /**
   * Credenciales y destino en su sitio, pero ningun envio real correcto todavia.
   *
   * Existe porque decir "Operativa en producción" con solo mirar la
   * configuracion resulto ser falso: Facebook aparecia asi el mismo dia en que
   * su ultima publicacion real habia fallado por permisos. Configurar y
   * publicar son dos cosas distintas y merecen dos estados distintos.
   */
  | "CONNECTED_UNVERIFIED"
  | "SIMULATED"
  | "PENDING_CONFIGURATION"
  | "PENDING_EXTERNAL_VERIFICATION"
  | "PENDING_PROVIDER_APPROVAL"
  | "PENDING_AD_ACCOUNT"
  | "NOT_READY"
  | "ERROR";

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
      state: "PENDING_CONFIGURATION",
      detail: window.error,
      nextStep: `Define ${MESSAGING_LIVE_FROM} con una fecha ISO 8601 en UTC. Hasta entonces no se envía ningún correo.`,
    };
  }
  if (config.provider === "none") {
    return {
      key: "email",
      name: "Correo electrónico",
      state: "PENDING_CONFIGURATION",
      detail: config.reason ?? "Falta configurar el correo saliente.",
      nextStep: "Agrega EMAIL_FROM, SMTP_HOST, SMTP_USER y SMTP_PASSWORD en Vercel.",
    };
  }
  if (simulation) {
    return {
      key: "email",
      name: "Correo electrónico",
      state: "SIMULATED",
      detail: `Configurado (${config.from}), pero el entorno actual no envía correos reales.`,
      nextStep: "Para enviar de verdad, MESSAGING_MODE debe ser live en Producción.",
    };
  }
  return {
    key: "email",
    name: "Correo electrónico",
    state: "READY",
    detail: `Envío real por ${config.host}:${config.port} como ${config.from}.`,
    nextStep: window.state === "live"
      ? `Solo salen mensajes programados desde el ${guayaquil.format(window.liveFrom)}. Lo anterior queda visible pero no se envía.`
      : null,
  };
}

/**
 * Redes cuyo ultimo envio real se completo correctamente.
 *
 * Lo aporta quien llama, porque exige consultar el historial y este modulo no
 * habla con la base. Ausente significa "no se sabe", y no saberlo nunca puede
 * leerse como verificado.
 */
export type PublicacionesVerificadas = Partial<Record<"FACEBOOK" | "INSTAGRAM", boolean>>;

function metaStatus(platform: "FACEBOOK" | "INSTAGRAM", verificadas: PublicacionesVerificadas = {}): IntegrationStatus {
  const config = describeMetaConfig(resolveMetaConfig());
  const isFacebook = platform === "FACEBOOK";
  const name = isFacebook ? "Facebook (publicación orgánica)" : "Instagram (publicación orgánica)";
  const identifier = isFacebook ? config.pageId : config.instagramAccountId;
  const window = resolveSocialWindow();
  if (window.state === "blocked") {
    return {
      key: platform.toLowerCase(),
      name,
      state: "PENDING_CONFIGURATION",
      detail: window.error,
      nextStep: `Define ${SOCIAL_LIVE_FROM} con una fecha ISO 8601 en UTC. Hasta entonces no se publica nada.`,
    };
  }
  if (!config.tokenConfigured || !identifier) {
    return {
      key: platform.toLowerCase(),
      name,
      state: "PENDING_CONFIGURATION",
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
      state: "SIMULATED",
      detail: `Credenciales presentes (Graph ${config.graphVersion}), pero el entorno actual no publica contenido real.`,
      nextStep: "Para publicar de verdad, SOCIAL_MODE debe ser live en Producción.",
    };
  }
  const ventana = window.state === "live"
    ? `Solo se publica lo programado desde el ${guayaquil.format(window.liveFrom)}. Lo anterior queda visible pero no sale.`
    : null;

  // Sin un envio real correcto, lo unico demostrado es que la configuracion
  // esta puesta. Afirmar mas fue exactamente el error anterior.
  if (!verificadas[platform]) {
    return {
      key: platform.toLowerCase(),
      name,
      state: "CONNECTED_UNVERIFIED",
      detail: `Credenciales y ${isFacebook ? "página" : "cuenta"} ${identifier} configuradas con Graph ${config.graphVersion}, pero todavía no hay ninguna publicación real correcta.`,
      nextStep: "Publica una vez para verificar el canal de extremo a extremo. Hasta entonces no se puede dar por operativo.",
    };
  }

  return {
    key: platform.toLowerCase(),
    name,
    state: "READY",
    detail: `Publicación real verificada con Graph ${config.graphVersion} (${isFacebook ? "página" : "cuenta"} ${identifier}).`,
    nextStep: ventana,
  };
}

function tiktokStatus(): IntegrationStatus {
  const configured = Boolean(process.env.TIKTOK_CLIENT_KEY?.trim() && process.env.TIKTOK_CLIENT_SECRET?.trim());
  // El CRM no tiene ruta de publicación productiva a TikTok: no hay Login Kit,
  // ni callback, ni almacenamiento de tokens. Declararla "operativa" porque
  // existan credenciales sería engañoso.
  return {
    key: "tiktok",
    name: "TikTok",
    state: configured ? "PENDING_PROVIDER_APPROVAL" : "NOT_READY",
    detail: configured
      ? "Aplicación y Sandbox configurados en el portal de TikTok, pero el CRM aún no implementa Login Kit, callback ni publicación."
      : "Configuración externa lista en el portal de TikTok (Sandbox). El CRM no tiene integración implementada.",
    nextStep: "Falta: Login Kit con state firmado, callback /api/integrations/tiktok/callback, almacenamiento y refresco de tokens, y prueba en Sandbox. No se pueden crear publicaciones de TikTok hasta entonces.",
  };
}

function whatsappStatus(): IntegrationStatus {
  const wa = describeWhatsAppConfig();
  if (wa.mode === "disabled") {
    return {
      key: "whatsapp",
      name: "WhatsApp",
      state: "PENDING_CONFIGURATION",
      detail: "Canal deshabilitado: WHATSAPP_MODE no está definido como 'simulation' ni 'live'. No envía ni simula, y el correo no se ve afectado.",
      nextStep: "Define WHATSAPP_MODE cuando las plantillas estén aprobadas en Meta.",
    };
  }
  if (wa.windowState === "blocked") {
    return {
      key: "whatsapp",
      name: "WhatsApp",
      state: "NOT_READY",
      detail: wa.blockedReason ?? "El canal está bloqueado.",
      nextStep: "Corrige la configuración indicada; hasta entonces no se envía nada y los mensajes siguen en cola.",
    };
  }
  if (wa.windowState === "simulation") {
    return {
      key: "whatsapp",
      name: "WhatsApp",
      state: "SIMULATED",
      detail: "En simulación: los mensajes se registran como SIMULADO y no se llama a Meta.",
      nextStep: wa.webhookReady
        ? "Aprueba las plantillas en Meta y pasa WHATSAPP_MODE a live."
        : "Faltan META_APP_SECRET o META_WEBHOOK_VERIFY_TOKEN para dar de alta el webhook de estados.",
    };
  }
  return {
    key: "whatsapp",
    name: "WhatsApp",
    state: "READY",
    detail: `Envío real desde ${wa.liveFrom}. Solo salen mensajes programados a partir de esa fecha.`,
    nextStep: wa.webhookReady
      ? null
      : "Sin webhook los mensajes se quedan en ACEPTADO: nunca constará ENTREGADO ni LEÍDO.",
  };
}

function adsStatus(): IntegrationStatus {
  const config = describeMetaConfig(resolveMetaConfig());
  return {
    key: "meta_ads",
    name: "Campañas pagadas de Meta",
    state: "PENDING_AD_ACCOUNT",
    detail: config.adAccountConfigured
      ? "Hay META_AD_ACCOUNT_ID declarado, pero el CRM no implementa gestión de campañas pagadas."
      : "No hay cuenta publicitaria asignada al portafolio Research Assessor & Training, y el CRM no implementa campañas pagadas.",
    nextStep: "Falta: crear o asignar una cuenta publicitaria al portafolio y concederla al usuario del sistema. La publicación orgánica es independiente y no se ve afectada.",
  };
}

/**
 * Presenta únicamente si la autenticación del scheduler está configurada.
 * La ejecución real sigue dependiendo del scheduler externo y sus logs.
 */
function cronStatus(): IntegrationStatus {
  const secretConfigured = Boolean(process.env.CRON_SECRET?.trim());
  if (!secretConfigured) {
    return {
      key: "cron",
      name: "Procesos programados",
      state: "PENDING_CONFIGURATION",
      detail: "Sin CRON_SECRET los endpoints de automatización no pueden autenticarse en Producción.",
      nextStep: "Define CRON_SECRET en Vercel y el mismo valor como secreto del repositorio.",
    };
  }
  return {
    key: "cron",
    name: "Procesos programados",
    state: "CONNECTED_UNVERIFIED",
    detail: "La autenticación de los procesos programados está configurada. La ejecución se comprueba en los logs del scheduler externo.",
    nextStep: null,
  };
}

export function integrationStatuses(verificadas: PublicacionesVerificadas = {}): IntegrationStatus[] {
  return [
    emailStatus(),
    metaStatus("FACEBOOK", verificadas),
    metaStatus("INSTAGRAM", verificadas),
    tiktokStatus(),
    whatsappStatus(),
    adsStatus(),
    cronStatus(),
  ];
}

/**
 * Etiquetas honestas: ningún módulo debe decir "Activo" cuando solo existe
 * código y credenciales pero no ejecución automática comprobada.
 */
export const INTEGRATION_STATE_LABELS: Record<IntegrationState, string> = {
  READY: "Operativo",
  CONNECTED_UNVERIFIED: "Configurado",
  SIMULATED: "En simulación",
  PENDING_CONFIGURATION: "Requiere configuración",
  PENDING_EXTERNAL_VERIFICATION: "En revisión externa",
  PENDING_PROVIDER_APPROVAL: "Esperando proveedor",
  PENDING_AD_ACCOUNT: "Requiere configuración",
  NOT_READY: "Desconectado",
  ERROR: "Incidencia",
};
