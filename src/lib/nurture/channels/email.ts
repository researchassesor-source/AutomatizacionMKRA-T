import type { MessageChannelAdapter, SendInput, SendResult } from "./types";

/**
 * Canal de email.
 *
 * Si hay EMAIL_API_KEY configurada usa el proveedor (aqui, Resend como
 * ejemplo). Si no, informa una simulacion sin imprimir datos personales.
 */
export class EmailChannel implements MessageChannelAdapter {
  readonly channel = "EMAIL" as const;

  constructor(
    private readonly config: {
      apiKey?: string;
      from?: string;
    } = {},
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.from);
  }

  async send(input: SendInput): Promise<SendResult> {
    if (!this.isConfigured()) {
      return { ok: true, simulated: true };
    }

    try {
      // Ejemplo con Resend (https://resend.com). Cambia por tu proveedor.
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: input.to,
          subject: input.subject ?? "RA-Training",
          html: input.body,
        }),
      });
      if (!res.ok) {
        return { ok: false, error: `El proveedor de correo respondió ${res.status}.` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
