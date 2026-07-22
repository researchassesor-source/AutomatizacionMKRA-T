import type { MessageChannelAdapter, SendInput, SendResult } from "./types";

/**
 * Canal de WhatsApp via WhatsApp Cloud API (Meta).
 *
 * Sin credenciales cae al modo "log" para poder probar la secuencia.
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
      console.log(`[whatsapp:log] PARA ${input.to}\n${input.body}\n`);
      return { ok: true };
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
      if (!res.ok) {
        return { ok: false, error: `whatsapp ${res.status}: ${await res.text()}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
