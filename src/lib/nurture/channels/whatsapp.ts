import { DEFAULT_GRAPH_API_VERSION } from "@/lib/social/meta-config";
import { logWhatsAppEvent } from "@/lib/whatsapp/observability";
import type { MessageChannelAdapter, SendInput, SendResult } from "./types";

/**
 * Canal de WhatsApp via WhatsApp Cloud API (Meta).
 *
 * Dos reglas gobiernan este adaptador:
 *
 * 1. Un mensaje iniciado por la empresa sale como plantilla aprobada o no sale.
 *    La "ventana de servicio" de 24 horas solo se abre cuando el contacto
 *    escribe primero; para una inscripcion nueva no existe. Enviar texto libre
 *    ahi no es un envio con menos garantias: es un rechazo seguro de Meta.
 *
 * 2. Nunca se declara aceptado sin prueba. Meta puede responder 200 con un
 *    `error` en el cuerpo, o con un cuerpo que no es JSON; ambos casos son
 *    fallos aunque el codigo HTTP diga lo contrario.
 */

/** Errores de Graph que no mejoran reintentando: reintentar solo hace ruido. */
const PERMANENT_ERROR_CODES = new Set([
  100, // parametros invalidos
  131_008, // falta un parametro obligatorio
  131_009, // valor de parametro invalido
  131_026, // el numero no puede recibir mensajes
  131_047, // fuera de la ventana de servicio: hace falta plantilla
  131_051, // tipo de mensaje no admitido
  132_000, // numero de parametros de la plantilla incorrecto
  132_001, // la plantilla no existe o no esta aprobada
  132_005, // el texto traducido de la plantilla es demasiado largo
  132_007, // el formato del parametro viola la politica
  132_012, // el formato del parametro no coincide con la plantilla
  133_010, // el numero no esta registrado
]);

/** Errores de autenticacion: el token caduco, se revoco o no tiene permisos. */
const AUTH_ERROR_CODES = new Set([0, 190, 200, 10, 3]);

type GraphError = { code?: number; error_subcode?: number; message?: string; type?: string };

export function describeWhatsAppError(error: GraphError | undefined, httpStatus: number): {
  errorCode: string;
  error: string;
  permanent: boolean;
} {
  const code = error?.code;
  const messages: Record<number, string> = {
    190: "El token de WhatsApp caducó o fue revocado. Genera uno nuevo para el usuario del sistema.",
    200: "El token no tiene los permisos necesarios (whatsapp_business_messaging).",
    10: "Meta rechazó el envío por permisos insuficientes.",
    4: "Se alcanzó el límite de solicitudes de Meta. Se reintentará más tarde.",
    80007: "Se alcanzó el límite de mensajes del número. Se reintentará más tarde.",
    131008: "Falta un parámetro obligatorio en la plantilla.",
    131026: "El número de destino no puede recibir mensajes de WhatsApp.",
    131047: "Han pasado más de 24 horas desde el último mensaje del contacto: solo se admite una plantilla aprobada.",
    131049: "Meta limitó este envío para cuidar la experiencia del destinatario.",
    132000: "La plantilla espera un número distinto de parámetros.",
    132001: "La plantilla no existe con ese nombre e idioma, o todavía no está aprobada.",
    132007: "El contenido de un parámetro viola la política de plantillas.",
    132012: "El formato de un parámetro no coincide con el declarado en la plantilla.",
    133010: "El número no está registrado en WhatsApp Business.",
  };
  const isAuth = code !== undefined && AUTH_ERROR_CODES.has(code);
  return {
    errorCode: code !== undefined ? `WHATSAPP_${code}` : `HTTP_${httpStatus}`,
    error:
      (code !== undefined && messages[code])
      || error?.message?.slice(0, 300)
      || `WhatsApp respondió ${httpStatus} sin un motivo reconocible.`,
    // Un fallo de autenticacion es permanente hasta que alguien cambie el
    // token: reintentar cinco veces con el mismo token caducado no ayuda.
    permanent: isAuth || (code !== undefined && PERMANENT_ERROR_CODES.has(code)),
  };
}

export class WhatsAppChannel implements MessageChannelAdapter {
  readonly channel = "WHATSAPP" as const;

  constructor(
    private readonly config: {
      phoneNumberId?: string;
      accessToken?: string;
      graphVersion?: string;
    } = {},
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.phoneNumberId && this.config.accessToken);
  }

  async send(input: SendInput): Promise<SendResult> {
    // Contexto comun de la traza. Nunca incluye destinatario ni contenido:
    // ver la justificacion en `lib/whatsapp/observability`.
    const traza = {
      mensajeId: input.reference ?? "sin-referencia",
      plantilla: input.template?.name ?? null,
      idioma: input.template?.language ?? null,
    };

    if (!this.isConfigured()) {
      logWhatsAppEvent({ evento: "envio_bloqueado", codigo: "WHATSAPP_CREDENTIALS_MISSING", mensajeId: traza.mensajeId, plantilla: traza.plantilla });
      return {
        ok: false,
        errorCode: "WHATSAPP_CREDENTIALS_MISSING",
        error: "Faltan WHATSAPP_PHONE_NUMBER_ID o WHATSAPP_ACCESS_TOKEN. No se intentó ningún envío.",
        providerName: "whatsapp_cloud",
      };
    }

    const version = this.config.graphVersion ?? DEFAULT_GRAPH_API_VERSION;
    const url = `https://graph.facebook.com/${version}/${this.config.phoneNumberId}/messages`;
    // La cita, cuando la hay. Va fuera del if para no repetirla en las dos ramas.
    const contexto = input.contextMessageId ? { context: { message_id: input.contextMessageId } } : {};
    const payload = input.template
      ? {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "template",
          ...contexto,
          template: {
            name: input.template.name,
            language: { code: input.template.language },
            components: input.template.components,
          },
        }
      : {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "text",
          ...contexto,
          text: { preview_url: false, body: input.body },
        };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      logWhatsAppEvent({ evento: "envio_rechazado", ...traza, codigo: "NETWORK_ERROR", httpStatus: null, graphCode: null, permanente: false });
      return { ok: false, errorCode: "NETWORK_ERROR", error: (err as Error).message.slice(0, 300), providerName: "whatsapp_cloud" };
    }

    type GraphEnvelope = { messages?: Array<{ id?: string }>; error?: GraphError };
    const raw = await res.text().catch(() => "");
    let data: GraphEnvelope | null = null;
    try {
      data = raw ? (JSON.parse(raw) as GraphEnvelope) : null;
    } catch {
      // Un cuerpo que no es JSON casi siempre es una pagina de error de la
      // pasarela. No es aceptacion aunque el codigo HTTP sea 200.
      logWhatsAppEvent({ evento: "envio_rechazado", ...traza, codigo: "INVALID_JSON", httpStatus: res.status, graphCode: null, permanente: false });
      return {
        ok: false,
        errorCode: "INVALID_JSON",
        error: `WhatsApp respondió ${res.status} con un cuerpo que no es JSON.`,
        providerName: "whatsapp_cloud",
        providerResponse: { httpStatus: res.status, bodyLength: raw.length },
      };
    }

    // Un `error` en el cuerpo manda sobre el codigo HTTP: Meta devuelve 200 con
    // error en algunos casos, y darlo por bueno inventaria una aceptacion.
    if (data?.error || !res.ok) {
      const described = describeWhatsAppError(data?.error, res.status);
      logWhatsAppEvent({
        evento: "envio_rechazado",
        ...traza,
        codigo: described.errorCode,
        httpStatus: res.status,
        graphCode: data?.error?.code ?? null,
        permanente: described.permanent,
      });
      return {
        ok: false,
        errorCode: described.errorCode,
        error: described.error,
        permanent: described.permanent,
        providerName: "whatsapp_cloud",
        providerResponse: {
          httpStatus: res.status,
          graphCode: data?.error?.code ?? null,
          graphSubcode: data?.error?.error_subcode ?? null,
        },
      };
    }

    const providerMessageId = data?.messages?.[0]?.id;
    if (!providerMessageId) {
      logWhatsAppEvent({ evento: "envio_rechazado", ...traza, codigo: "MISSING_PROVIDER_ID", httpStatus: res.status, graphCode: null, permanente: false });
      return {
        ok: false,
        errorCode: "MISSING_PROVIDER_ID",
        error: "WhatsApp respondió sin devolver el identificador del mensaje (wamid), así que no hay prueba de aceptación.",
        providerName: "whatsapp_cloud",
        providerResponse: { httpStatus: res.status },
      };
    }

    logWhatsAppEvent({ evento: "envio_aceptado", ...traza, wamid: providerMessageId, httpStatus: res.status });
    return {
      ok: true,
      providerName: "whatsapp_cloud",
      providerMessageId,
      acceptedAt: new Date(),
      providerResponse: { httpStatus: res.status, template: input.template?.name ?? null },
    };
  }
}
