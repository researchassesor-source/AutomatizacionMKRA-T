import { resolveEmailConfig, type EmailConfig } from "@/lib/email/config";
import { buildEmailDocument } from "@/lib/email/render";
import { sendSmtpEmail } from "@/lib/email/smtp";
import type { MessageChannelAdapter, SendInput, SendResult } from "./types";

/**
 * Canal de correo.
 *
 * Proveedor principal: SMTP institucional (cPanel, mail.ra-training.com).
 * Respaldo: Resend por HTTP, conservado para no romper despliegues anteriores
 * que solo tienen EMAIL_API_KEY. La eleccion vive en @/lib/email/config.
 *
 * Sin credenciales, el canal informa una simulacion en lugar de fallar, para
 * que un entorno sin correo no bloquee el resto del CRM.
 */
export class EmailChannel implements MessageChannelAdapter {
  readonly channel = "EMAIL" as const;

  constructor(private readonly config: EmailConfig = resolveEmailConfig()) {}

  isConfigured(): boolean {
    return this.config.provider !== "none";
  }

  async send(input: SendInput): Promise<SendResult> {
    if (!this.isConfigured() || !this.config.identity) {
      return { ok: true, simulated: true };
    }
    const document = buildEmailDocument({
      subject: input.subject ?? "R.A. Training",
      body: input.body,
      brandName: this.config.identity.fromName,
    });
    return this.config.provider === "smtp" && this.config.smtp
      ? this.sendWithSmtp(input.to, document)
      : this.sendWithResend(input.to, document);
  }

  private async sendWithSmtp(to: string, document: ReturnType<typeof buildEmailDocument>): Promise<SendResult> {
    const smtpConfig = this.config as EmailConfig & { smtp: NonNullable<EmailConfig["smtp"]> };
    const result = await sendSmtpEmail(smtpConfig, { to, document });
    if (!result.ok) {
      return {
        ok: false,
        providerName: "smtp",
        errorCode: result.errorCode,
        error: result.error,
        providerResponse: { transport: "smtp", host: smtpConfig.smtp.host, port: smtpConfig.smtp.port },
      };
    }
    return {
      ok: true,
      providerName: "smtp",
      providerMessageId: result.messageId ?? undefined,
      acceptedAt: new Date(),
      providerResponse: { transport: "smtp", accepted: result.accepted, response: result.response },
    };
  }

  private async sendWithResend(to: string, document: ReturnType<typeof buildEmailDocument>): Promise<SendResult> {
    if (!this.config.resendApiKey || !this.config.identity) return { ok: true, simulated: true };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${this.config.identity.fromName} <${this.config.identity.fromAddress}>`,
          reply_to: this.config.identity.replyTo ?? undefined,
          to,
          subject: document.subject,
          html: document.html,
          text: document.text,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string };
      if (!res.ok) {
        return {
          ok: false,
          errorCode: `HTTP_${res.status}`,
          error: "El proveedor de correo rechazó el envío.",
          providerName: "resend",
          providerResponse: { httpStatus: res.status },
        };
      }
      if (!data.id) {
        return { ok: false, errorCode: "MISSING_PROVIDER_ID", error: "El proveedor aceptó la solicitud sin devolver un identificador.", providerName: "resend" };
      }
      return { ok: true, providerName: "resend", providerMessageId: data.id, acceptedAt: new Date(), providerResponse: { httpStatus: res.status, idReceived: true } };
    } catch {
      return { ok: false, errorCode: "NETWORK_ERROR", error: "No se pudo contactar al proveedor de correo.", providerName: "resend" };
    }
  }
}
