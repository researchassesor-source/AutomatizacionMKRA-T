import type { MessageChannelAdapter, SendInput, SendResult } from "./types";

/**
 * Canal de WhatsApp via WhatsApp Cloud API (Meta).
 *
 * Sin credenciales responde en modo de simulacion sin exponer el mensaje.
 *
 * Nota importante: WhatsApp solo permite iniciar conversaciones con
 * "plantillas" (templates) aprobadas. Este adaptador envia texto simple, que
 * funciona dentro de la ventana de 24h; para mensajes iniciales usa plantillas
 * aprobadas en tu cuenta de WhatsApp Business.
 */
export class WhatsAppChannel implements MessageChannelAdapter {
  readonly channel = "WHATSAPP" as const;

  constructor(
    private readonly config: {
      phoneNumberId?: string;
      accessToken?: string;
    } = {},
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.phoneNumberId && this.config.accessToken);
  }

  async send(input: SendInput): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { ok: true, simulated: true };
    }

    try {
      const url = `https://graph.facebook.com/v21.0/${this.config.phoneNumberId}/messages`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "text",
          text: { body: input.body },
        }),
      });
      const data = await res.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
      if (!res.ok) {
        return {
          ok: false,
          errorCode: `HTTP_${res.status}`,
          error: `El proveedor de WhatsApp respondió ${res.status}.`,
          providerName: "whatsapp_cloud",
          providerResponse: { httpStatus: res.status },
        };
      }
      const providerMessageId = data.messages?.[0]?.id;
      if (!providerMessageId) return { ok: false, errorCode: "MISSING_PROVIDER_ID", error: "WhatsApp aceptó la solicitud sin devolver un identificador.", providerName: "whatsapp_cloud" };
      return { ok: true, providerName: "whatsapp_cloud", providerMessageId, acceptedAt: new Date(), providerResponse: { httpStatus: res.status, idReceived: true } };
    } catch (err) {
      return { ok: false, errorCode: "NETWORK_ERROR", error: (err as Error).message, providerName: "whatsapp_cloud" };
    }
  }
}
