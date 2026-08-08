/**
 * Configuracion unica de Meta (Facebook Pages + Instagram Graph API).
 *
 * El proyecto usaba META_ACCESS_TOKEN / META_IG_USER_ID. La cuenta de
 * produccion se administra con un usuario del sistema, cuyo token ya esta en
 * Vercel como META_SYSTEM_USER_TOKEN. Se aceptan ambos nombres para no romper
 * despliegues previos, con el nombre nuevo como preferente.
 */
export const DEFAULT_GRAPH_API_VERSION = "v25.0";

export type MetaConfig = {
  accessToken?: string;
  pageId?: string;
  igUserId?: string;
  appId?: string;
  /**
   * Secreto de la app. Solo lo usa `debug_token`, que exige un token de
   * aplicacion (`appId|appSecret`) para poder leer los permisos del token del
   * sistema. Nunca se envia a otro sitio ni se muestra.
   */
  appSecret?: string;
  businessId?: string;
  graphVersion: string;
  adAccountId?: string;
};

function value(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeVersion(raw: string | undefined): string {
  const candidate = value(raw);
  if (!candidate) return DEFAULT_GRAPH_API_VERSION;
  const normalized = candidate.startsWith("v") ? candidate : `v${candidate}`;
  return /^v\d+\.\d+$/.test(normalized) ? normalized : DEFAULT_GRAPH_API_VERSION;
}

/** Fuente de variables: `process.env` en ejecución, un objeto plano en pruebas. */
export type EnvSource = Record<string, string | undefined>;

export function resolveMetaConfig(env: EnvSource = process.env): MetaConfig {
  return {
    accessToken: value(env.META_SYSTEM_USER_TOKEN) ?? value(env.META_ACCESS_TOKEN),
    pageId: value(env.META_PAGE_ID),
    igUserId: value(env.META_INSTAGRAM_ACCOUNT_ID) ?? value(env.META_IG_USER_ID),
    appId: value(env.META_APP_ID),
    appSecret: value(env.META_APP_SECRET),
    businessId: value(env.META_BUSINESS_ID),
    graphVersion: normalizeVersion(env.META_GRAPH_API_VERSION),
    adAccountId: value(env.META_AD_ACCOUNT_ID),
  };
}

/** Resumen para la interfaz. Nunca incluye el token, ni siquiera parcial. */
export function describeMetaConfig(config: MetaConfig = resolveMetaConfig()) {
  return {
    tokenConfigured: Boolean(config.accessToken),
    pageId: config.pageId ?? null,
    instagramAccountId: config.igUserId ?? null,
    appId: config.appId ?? null,
    businessId: config.businessId ?? null,
    graphVersion: config.graphVersion,
    adAccountConfigured: Boolean(config.adAccountId),
  };
}

/**
 * Traduce los errores de la Graph API a un texto accionable en español. El
 * cuerpo tecnico completo se guarda en `providerResponse`, nunca se muestra.
 */
export function describeMetaError(error: { code?: number; error_subcode?: number; message?: string } | undefined): {
  errorCode: string;
  error: string;
} {
  const code = error?.code;
  const messages: Record<number, string> = {
    190: "El token de Meta caducó o fue revocado. Genera uno nuevo para el usuario del sistema.",
    200: "Meta rechazó la publicación por permisos insuficientes sobre la página o la cuenta de Instagram.",
    10: "Meta rechazó la publicación por permisos insuficientes.",
    100: "Meta rechazó los datos enviados. Revisa el texto, el enlace y la URL de la imagen.",
    4: "Se alcanzó el límite de solicitudes de Meta. Reintenta más tarde.",
    17: "Se alcanzó el límite de solicitudes de Meta para esta cuenta. Reintenta más tarde.",
    32: "Se alcanzó el límite de publicaciones de la página. Reintenta más tarde.",
    368: "Meta bloqueó temporalmente esta acción en la cuenta.",
    2207003: "Meta no pudo descargar la imagen. Debe estar disponible en una URL pública HTTPS.",
    2207020: "El formato o la proporción de la imagen no cumple los requisitos de Instagram.",
    2207026: "El video no cumple los requisitos de Instagram.",
    9007: "La cuenta de Instagram alcanzó su límite de publicaciones para hoy.",
  };
  return {
    errorCode: code !== undefined ? `META_${code}` : "META_ERROR",
    error: (code !== undefined && messages[code]) || "Meta rechazó la publicación. Revisa el detalle técnico en la auditoría.",
  };
}
