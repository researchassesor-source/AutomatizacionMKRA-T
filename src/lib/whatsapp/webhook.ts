import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderDeliveryState } from "@/lib/nurture/provider-events";

/**
 * Verificacion y lectura del webhook de WhatsApp Cloud API.
 *
 * Todo lo de este archivo trabaja sobre el cuerpo CRUDO de la peticion. Volver
 * a serializar el JSON antes de comprobar la firma la invalidaria: un cambio de
 * orden de claves o de espaciado produce otro HMAC.
 */
export const SIGNATURE_HEADER = "x-hub-signature-256";

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "MISSING_SECRET" | "MISSING_SIGNATURE" | "MALFORMED_SIGNATURE" | "INVALID_SIGNATURE" };

/**
 * HMAC-SHA256 del cuerpo crudo con el App Secret, comparado en tiempo
 * constante. Sin secreto configurado NO se acepta la peticion: un webhook
 * publico sin firma verificada permitiria a cualquiera inventar estados de
 * entrega en el CRM.
 */
export function verifySignature(rawBody: string, header: string | null, appSecret: string | undefined): SignatureCheck {
  if (!appSecret) return { ok: false, reason: "MISSING_SECRET" };
  if (!header) return { ok: false, reason: "MISSING_SIGNATURE" };
  const [algorithm, digest] = header.split("=");
  if (algorithm !== "sha256" || !digest || !/^[0-9a-f]+$/i.test(digest)) {
    return { ok: false, reason: "MALFORMED_SIGNATURE" };
  }
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const supplied = Buffer.from(digest.toLowerCase(), "hex");
  const computed = Buffer.from(expected, "hex");
  // timingSafeEqual exige la misma longitud; una firma corta se descarta antes
  // de comparar para no lanzar, pero sin revelar nada del valor esperado.
  if (supplied.length !== computed.length) return { ok: false, reason: "INVALID_SIGNATURE" };
  return timingSafeEqual(supplied, computed) ? { ok: true } : { ok: false, reason: "INVALID_SIGNATURE" };
}

export type VerificationQuery = {
  mode: string | null;
  token: string | null;
  challenge: string | null;
};

export type VerificationResult =
  | { ok: true; challenge: string }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Handshake GET de Meta. Devuelve el `hub.challenge` tal cual solo si el modo
 * es `subscribe` y el token coincide exactamente.
 */
export function resolveVerification(query: VerificationQuery, verifyToken: string | undefined): VerificationResult {
  if (!verifyToken) {
    return { ok: false, status: 403, error: "El servidor no tiene META_WEBHOOK_VERIFY_TOKEN configurado." };
  }
  if (!query.mode || !query.token || !query.challenge) {
    return { ok: false, status: 400, error: "Faltan parámetros de verificación (hub.mode, hub.verify_token, hub.challenge)." };
  }
  if (query.mode !== "subscribe") {
    return { ok: false, status: 400, error: "hub.mode no es 'subscribe'." };
  }
  const supplied = Buffer.from(query.token, "utf8");
  const expected = Buffer.from(verifyToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { ok: false, status: 403, error: "El token de verificación no coincide." };
  }
  return { ok: true, challenge: query.challenge };
}

/** Estados que Meta reporta en `statuses[]`, traducidos al vocabulario interno. */
const STATUS_MAP: Record<string, ProviderDeliveryState> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export type StatusEvent = {
  /** `wamid` del mensaje: la clave con la que se correlaciona en el CRM. */
  providerMessageId: string;
  state: ProviderDeliveryState;
  occurredAt: Date;
  /**
   * Identificador estable del evento. Meta no envia uno, asi que se compone:
   * un mismo mensaje solo puede alcanzar cada estado una vez, de modo que
   * `wamid:estado` hace idempotentes los reintentos de Meta.
   */
  providerEventId: string;
  errorCode?: string;
  errorMessage?: string;
};

export type InboundNotice = {
  /** Tipo declarado por Meta (text, image, ...). Nunca se guarda el contenido. */
  type: string;
  /** Identificador del mensaje entrante, util para trazar sin exponer el texto. */
  providerMessageId: string;
  /** Remitente declarado por Meta. Solo se usa para responder y limitar frecuencia. */
  sender: string;
  /** Número automático receptor, usado para impedir respuestas a sí mismo. */
  businessPhone?: string;
};

export type ParsedWebhook = {
  statuses: StatusEvent[];
  inbound: InboundNotice[];
  /** Cambios que no son del campo `messages`; se cuentan y se ignoran. */
  ignoredFields: string[];
};

function toDate(timestamp: unknown): Date {
  // Meta envia segundos epoch como texto.
  const seconds = typeof timestamp === "string" ? Number.parseInt(timestamp, 10) : typeof timestamp === "number" ? timestamp : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1000);
}

/**
 * Lee el payload sin confiar en su forma. Un cuerpo malformado produce listas
 * vacias, nunca una excepcion: Meta reintenta cualquier respuesta que no sea
 * 200, y caerse ante un evento raro convierte un problema puntual en un bucle.
 */
export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  const result: ParsedWebhook = { statuses: [], inbound: [], ignoredFields: [] };
  const root = payload as { object?: unknown; entry?: unknown };
  if (!root || typeof root !== "object" || !Array.isArray(root.entry)) return result;

  for (const entry of root.entry) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const field = (change as { field?: unknown })?.field;
      if (field !== "messages") {
        if (typeof field === "string") result.ignoredFields.push(field);
        continue;
      }
      const value = (change as { value?: unknown })?.value as
        | { statuses?: unknown; messages?: unknown; metadata?: unknown }
        | undefined;
      if (!value || typeof value !== "object") continue;

      if (Array.isArray(value.statuses)) {
        for (const raw of value.statuses) {
          const item = raw as { id?: unknown; status?: unknown; timestamp?: unknown; errors?: unknown };
          const providerMessageId = typeof item?.id === "string" ? item.id : null;
          const state = typeof item?.status === "string" ? STATUS_MAP[item.status] : undefined;
          if (!providerMessageId || !state) continue;
          const firstError = Array.isArray(item.errors) ? (item.errors[0] as { code?: unknown; title?: unknown; message?: unknown }) : undefined;
          result.statuses.push({
            providerMessageId,
            state,
            occurredAt: toDate(item.timestamp),
            providerEventId: `${providerMessageId}:${state}`,
            errorCode: firstError?.code !== undefined ? `WHATSAPP_${String(firstError.code)}` : undefined,
            errorMessage: typeof firstError?.title === "string"
              ? firstError.title
              : typeof firstError?.message === "string"
                ? firstError.message
                : undefined,
          });
        }
      }

      if (Array.isArray(value.messages)) {
        const metadata = value.metadata as { display_phone_number?: unknown } | undefined;
        const businessPhone = typeof metadata?.display_phone_number === "string"
          ? metadata.display_phone_number
          : undefined;
        for (const raw of value.messages) {
          const item = raw as { id?: unknown; type?: unknown; from?: unknown };
          if (typeof item?.id !== "string" || typeof item.from !== "string") continue;
          result.inbound.push({
            providerMessageId: item.id,
            type: typeof item.type === "string" ? item.type : "desconocido",
            sender: item.from,
            businessPhone,
          });
        }
      }
    }
  }
  return result;
}
