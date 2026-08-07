import { allowedPrivacyLevels, type TikTokConfig } from "./config";

/**
 * Content Posting API.
 *
 * Dos caminos distintos y deliberadamente separados:
 *  - `inbox/video/init`  → carga como BORRADOR. La persona termina y publica
 *    desde la app de TikTok. Solo necesita `video.upload`.
 *  - `video/init`        → Direct Post. Publica directamente. Necesita
 *    `video.publish` y, con el cliente sin auditar, exige cuenta en privado.
 *
 * Recibir HTTP 200 no significa que el vídeo esté publicado: solo que TikTok
 * aceptó la solicitud. El estado real se consulta con `status/fetch`.
 */
const API = "https://open.tiktokapis.com/v2";

export const CREATOR_INFO_URL = `${API}/post/publish/creator_info/query/`;
export const INBOX_INIT_URL = `${API}/post/publish/inbox/video/init/`;
export const DIRECT_POST_INIT_URL = `${API}/post/publish/video/init/`;
export const STATUS_FETCH_URL = `${API}/post/publish/status/fetch/`;

type TikTokEnvelope<T> = { data?: T; error?: { code?: string; message?: string; log_id?: string } };

export type CreatorInfo = {
  nickname: string;
  username: string | null;
  avatarUrl: string | null;
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoDurationSec: number;
};

export type TikTokResult<T> = { ok: true; data: T } | { ok: false; errorCode: string; error: string; logId?: string };

/**
 * TikTok devuelve 200 con `error.code` distinto de `ok` en los fallos de
 * negocio. Tratar el 200 como éxito es el error clásico de esta API.
 */
function envelope<T>(payload: TikTokEnvelope<T>, httpOk: boolean): TikTokResult<T> {
  const code = payload.error?.code;
  if (code && code !== "ok") {
    return { ok: false, errorCode: code, error: describePublishError(code), logId: payload.error?.log_id };
  }
  if (!httpOk) return { ok: false, errorCode: "HTTP_ERROR", error: "TikTok rechazó la solicitud." };
  if (!payload.data) return { ok: false, errorCode: "EMPTY_RESPONSE", error: "TikTok respondió sin datos." };
  return { ok: true, data: payload.data };
}

async function call<T>(url: string, accessToken: string, body: unknown, fetcher: typeof fetch): Promise<TikTokResult<T>> {
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body ?? {}),
    });
    return envelope<T>((await response.json().catch(() => ({}))) as TikTokEnvelope<T>, response.ok);
  } catch {
    return { ok: false, errorCode: "NETWORK_ERROR", error: "No se pudo contactar con TikTok." };
  }
}

/**
 * Creator Info es obligatorio antes de publicar: define qué niveles de
 * privacidad ofrece la cuenta y qué interacciones están deshabilitadas.
 */
export async function fetchCreatorInfo(accessToken: string, fetcher: typeof fetch = fetch): Promise<TikTokResult<CreatorInfo>> {
  const result = await call<{
    creator_nickname?: string;
    creator_username?: string;
    creator_avatar_url?: string;
    privacy_level_options?: string[];
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  }>(CREATOR_INFO_URL, accessToken, {}, fetcher);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      nickname: result.data.creator_nickname ?? "",
      username: result.data.creator_username ?? null,
      avatarUrl: result.data.creator_avatar_url ?? null,
      privacyOptions: result.data.privacy_level_options ?? [],
      commentDisabled: Boolean(result.data.comment_disabled),
      duetDisabled: Boolean(result.data.duet_disabled),
      stitchDisabled: Boolean(result.data.stitch_disabled),
      maxVideoDurationSec: result.data.max_video_post_duration_sec ?? 0,
    },
  };
}

export type SourceInfo =
  | { source: "PULL_FROM_URL"; videoUrl: string }
  | { source: "FILE_UPLOAD"; videoSize: number; chunkSize: number; totalChunkCount: number };

function sourcePayload(source: SourceInfo) {
  return source.source === "PULL_FROM_URL"
    ? { source: "PULL_FROM_URL", video_url: source.videoUrl }
    : { source: "FILE_UPLOAD", video_size: source.videoSize, chunk_size: source.chunkSize, total_chunk_count: source.totalChunkCount };
}

export type InitResult = { publishId: string; uploadUrl: string | null };

/**
 * Carga como borrador. No publica: el vídeo llega a la bandeja de TikTok y la
 * persona lo termina desde la app. Es el flujo que no exige `video.publish`.
 */
export async function initDraftUpload(
  accessToken: string,
  source: SourceInfo,
  fetcher: typeof fetch = fetch,
): Promise<TikTokResult<InitResult>> {
  const result = await call<{ publish_id?: string; upload_url?: string }>(
    INBOX_INIT_URL,
    accessToken,
    { source_info: sourcePayload(source) },
    fetcher,
  );
  if (!result.ok) return result;
  if (!result.data.publish_id) {
    return { ok: false, errorCode: "MISSING_PUBLISH_ID", error: "TikTok aceptó la solicitud sin devolver identificador." };
  }
  return { ok: true, data: { publishId: result.data.publish_id, uploadUrl: result.data.upload_url ?? null } };
}

export type DirectPostOptions = {
  title: string;
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
};

export type ComplianceIssue =
  | "PRIVACY_NOT_SELECTED"
  | "PRIVACY_NOT_ALLOWED"
  | "DISCLOSURE_WITHOUT_SELECTION"
  | "BRANDED_CONTENT_REQUIRES_PUBLIC"
  | "CONSENT_MISSING";

export const COMPLIANCE_MESSAGES: Record<ComplianceIssue, string> = {
  PRIVACY_NOT_SELECTED: "Debes elegir manualmente quién puede ver el vídeo. No hay valor por defecto.",
  PRIVACY_NOT_ALLOWED: "Ese nivel de privacidad no está disponible para esta cuenta o para una aplicación sin auditar.",
  DISCLOSURE_WITHOUT_SELECTION: "Has activado la divulgación de contenido comercial: elige «Tu marca», «Contenido de marca» o ambas.",
  BRANDED_CONTENT_REQUIRES_PUBLIC: "El contenido de marca no puede publicarse en privado. Cambia la visibilidad o desactiva esa opción.",
  CONSENT_MISSING: "Falta aceptar la Confirmación de uso de música de TikTok (y la Política de contenido de marca, si aplica).",
};

/**
 * Reglas de la guía oficial de UX, comprobadas en el servidor.
 *
 * Validarlas solo en la interfaz no basta: la API es alcanzable directamente y
 * publicar sin consentimiento o con una combinación prohibida incumpliría la
 * política de TikTok igualmente.
 */
export function validatePostCompliance(
  options: DirectPostOptions & { consentAccepted: boolean },
  creatorInfo: Pick<CreatorInfo, "privacyOptions">,
  config: TikTokConfig,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (!options.privacyLevel) issues.push("PRIVACY_NOT_SELECTED");
  else {
    const offered = creatorInfo.privacyOptions.length ? creatorInfo.privacyOptions : allowedPrivacyLevels(config);
    if (!offered.includes(options.privacyLevel) || !allowedPrivacyLevels(config).includes(options.privacyLevel)) {
      issues.push("PRIVACY_NOT_ALLOWED");
    }
  }
  // El toggle de divulgación exige elegir al menos una modalidad.
  if (options.brandContentToggle === false && options.brandOrganicToggle === false) {
    // Sin divulgación activa no hay nada que comprobar.
  }
  if (options.brandContentToggle && options.privacyLevel === "SELF_ONLY") {
    issues.push("BRANDED_CONTENT_REQUIRES_PUBLIC");
  }
  if (!options.consentAccepted) issues.push("CONSENT_MISSING");
  return issues;
}

/** Comprueba el toggle de divulgación con su estado explícito. */
export function validateDisclosure(disclosureEnabled: boolean, yourBrand: boolean, brandedContent: boolean): ComplianceIssue[] {
  return disclosureEnabled && !yourBrand && !brandedContent ? ["DISCLOSURE_WITHOUT_SELECTION"] : [];
}

export async function initDirectPost(
  accessToken: string,
  source: SourceInfo,
  options: DirectPostOptions,
  fetcher: typeof fetch = fetch,
): Promise<TikTokResult<InitResult>> {
  const result = await call<{ publish_id?: string; upload_url?: string }>(
    DIRECT_POST_INIT_URL,
    accessToken,
    {
      post_info: {
        title: options.title.slice(0, 2200),
        privacy_level: options.privacyLevel,
        disable_comment: options.disableComment,
        disable_duet: options.disableDuet,
        disable_stitch: options.disableStitch,
        brand_content_toggle: options.brandContentToggle,
        brand_organic_toggle: options.brandOrganicToggle,
      },
      source_info: sourcePayload(source),
    },
    fetcher,
  );
  if (!result.ok) return result;
  if (!result.data.publish_id) {
    return { ok: false, errorCode: "MISSING_PUBLISH_ID", error: "TikTok aceptó la solicitud sin devolver identificador." };
  }
  return { ok: true, data: { publishId: result.data.publish_id, uploadUrl: result.data.upload_url ?? null } };
}

export type PublishStatus = {
  status: string;
  failReason: string | null;
  publiclyAvailablePostId: string | null;
  uploadedBytes: number | null;
};

/** Estados terminales según la documentación oficial. */
export const TERMINAL_STATUSES = ["PUBLISH_COMPLETE", "FAILED"] as const;

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export async function fetchPublishStatus(
  accessToken: string,
  publishId: string,
  fetcher: typeof fetch = fetch,
): Promise<TikTokResult<PublishStatus>> {
  const result = await call<{
    status?: string;
    fail_reason?: string;
    publicaly_available_post_id?: string[];
    publicly_available_post_id?: string[];
    uploaded_bytes?: number;
  }>(STATUS_FETCH_URL, accessToken, { publish_id: publishId }, fetcher);
  if (!result.ok) return result;
  // TikTok ha usado ambas grafías del campo en distintas versiones.
  const postIds = result.data.publicly_available_post_id ?? result.data.publicaly_available_post_id ?? [];
  return {
    ok: true,
    data: {
      status: result.data.status ?? "UNKNOWN",
      failReason: result.data.fail_reason ?? null,
      publiclyAvailablePostId: postIds[0] ?? null,
      uploadedBytes: result.data.uploaded_bytes ?? null,
    },
  };
}

/** Traducción de los errores documentados a algo accionable en español. */
export function describePublishError(code: string): string {
  const messages: Record<string, string> = {
    invalid_param: "TikTok rechazó los datos enviados. Revisa el texto y el archivo de vídeo.",
    spam_risk_too_many_posts: "La cuenta alcanzó su límite diario de publicaciones en TikTok.",
    spam_risk_user_banned_from_posting: "La cuenta tiene restringida la publicación en TikTok.",
    reached_active_user_cap: "Se alcanzó el número máximo de usuarios permitidos para esta aplicación en 24 horas.",
    unaudited_client_can_only_post_to_private_accounts:
      "La aplicación aún no está auditada por TikTok: solo puede publicar en cuentas configuradas como privadas.",
    url_ownership_unverified:
      "El dominio del vídeo no está verificado en TikTok. Verifica la propiedad de la URL antes de usar PULL_FROM_URL.",
    privacy_level_option_mismatch: "El nivel de privacidad elegido no está permitido para esta cuenta.",
    access_token_invalid: "La autorización de TikTok caducó. Vuelve a conectar la cuenta.",
    scope_not_authorized: "No se concedió el permiso necesario para esta acción.",
    rate_limit_exceeded: "Se superó el límite de solicitudes de TikTok. Reintenta en unos minutos.",
    file_format_check_failed: "El formato del vídeo no cumple los requisitos de TikTok.",
    duration_check_failed: "La duración del vídeo excede el máximo permitido para esta cuenta.",
    frame_rate_check_failed: "La tasa de fotogramas del vídeo no cumple los requisitos de TikTok.",
    picture_size_check_failed: "La resolución del vídeo no cumple los requisitos de TikTok.",
  };
  return messages[code] ?? "TikTok rechazó la operación.";
}

/** Estado del proveedor traducido para el panel. */
export function describePublishStatus(status: string): string {
  const messages: Record<string, string> = {
    PROCESSING_UPLOAD: "TikTok está procesando el vídeo.",
    PROCESSING_DOWNLOAD: "TikTok está descargando el vídeo desde la URL indicada.",
    SEND_TO_USER_INBOX: "El vídeo llegó a la bandeja de TikTok. Termina la publicación desde la aplicación.",
    PUBLISH_COMPLETE: "Publicación completada en TikTok.",
    FAILED: "TikTok no pudo procesar el vídeo.",
    UNKNOWN: "Estado desconocido.",
  };
  return messages[status] ?? `Estado informado por TikTok: ${status}`;
}
