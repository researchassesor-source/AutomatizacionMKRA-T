import nodemailer, { type Transporter } from "nodemailer";
import { formatSender, type EmailConfig, type SmtpSettings } from "./config";
import type { EmailDocument } from "./render";

/**
 * Transporte SMTP del correo institucional (cPanel, mail.ra-training.com).
 *
 * El transporte se reutiliza entre invocaciones: crear uno por mensaje abre una
 * conexion TLS nueva cada vez y el servidor compartido corta por exceso de
 * conexiones. La clave de cache no incluye la contraseña.
 */
let cached: { key: string; transporter: Transporter } | null = null;

function transporterKey(settings: SmtpSettings): string {
  return `${settings.host}:${settings.port}:${settings.secure ? "tls" : "starttls"}:${settings.user}`;
}

export function getSmtpTransporter(settings: SmtpSettings): Transporter {
  const key = transporterKey(settings);
  if (cached?.key === key) return cached.transporter;
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 usa TLS implicito; 587 negocia STARTTLS. La validacion del certificado
    // nunca se desactiva: `rejectUnauthorized: false` abriria la puerta a un
    // intermediario que leeria las credenciales.
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
  });
  cached = { key, transporter };
  return transporter;
}

/** Solo para pruebas: obliga a reconstruir el transporte. */
export function resetSmtpTransporter() {
  cached = null;
}

export type SmtpSendResult =
  | { ok: true; messageId: string | null; accepted: number; response: string }
  | { ok: false; errorCode: string; error: string };

/**
 * Traduce los codigos de nodemailer/SMTP a un texto que el administrador pueda
 * accionar. El detalle tecnico completo queda en `providerResponse`.
 */
export function describeSmtpError(error: unknown): { errorCode: string; error: string } {
  const raw = error as { code?: string; responseCode?: number; message?: string } | null;
  const code = raw?.code ?? (raw?.responseCode ? `SMTP_${raw.responseCode}` : "SMTP_ERROR");
  const map: Record<string, string> = {
    EAUTH: "No se pudo autenticar con el servidor de correo. Revisa SMTP_USER y SMTP_PASSWORD.",
    ECONNECTION: "No se pudo conectar con el servidor de correo. Revisa SMTP_HOST y SMTP_PORT.",
    ECONNREFUSED: "El servidor de correo rechazó la conexión.",
    ETIMEDOUT: "El servidor de correo no respondió a tiempo.",
    ESOCKET: "La conexión segura con el servidor de correo falló.",
    EENVELOPE: "El servidor de correo rechazó la dirección del destinatario.",
    EDNS: "No se pudo resolver el nombre del servidor de correo.",
  };
  return { errorCode: code.slice(0, 120), error: map[code] ?? "El servidor de correo rechazó el envío." };
}

export async function sendSmtpEmail(
  config: EmailConfig & { smtp: SmtpSettings },
  input: { to: string; document: EmailDocument },
): Promise<SmtpSendResult> {
  if (!config.identity) return { ok: false, errorCode: "MISSING_SENDER", error: "Falta configurar el remitente institucional." };
  try {
    const info = await getSmtpTransporter(config.smtp).sendMail({
      from: formatSender(config.identity),
      to: input.to,
      replyTo: config.identity.replyTo ?? undefined,
      subject: input.document.subject,
      text: input.document.text,
      html: input.document.html,
    });
    if (!info.accepted?.length) {
      return { ok: false, errorCode: "RECIPIENT_REJECTED", error: "El servidor de correo no aceptó al destinatario." };
    }
    return { ok: true, messageId: info.messageId ?? null, accepted: info.accepted.length, response: String(info.response ?? "").slice(0, 200) };
  } catch (error) {
    return { ok: false, ...describeSmtpError(error) };
  }
}

/** Comprobacion de credenciales sin enviar ningun mensaje. */
export async function verifySmtpConnection(settings: SmtpSettings): Promise<{ ok: boolean; errorCode?: string; error?: string }> {
  try {
    await getSmtpTransporter(settings).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, ...describeSmtpError(error) };
  }
}
