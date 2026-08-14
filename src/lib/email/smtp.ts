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
  | { ok: false; errorCode: string; error: string; detalle?: SmtpDetalle };

/**
 * Lo que el servidor respondio de verdad, ya recortado.
 *
 * Nunca contiene credenciales: son la respuesta SMTP, el codigo numerico y las
 * direcciones que el servidor rechazo, que es exactamente lo que hace falta
 * para saber a quien reclamar.
 */
export type SmtpDetalle = {
  /** Respuesta literal del servidor, p. ej. "550 5.7.1 Relay denied". */
  respuesta: string | null;
  /** Codigo numerico SMTP, cuando el servidor lo devuelve. */
  codigoSmtp: number | null;
  /** Etapa en la que fallo: saludo, autenticacion, remitente, destinatario… */
  etapa: string | null;
  rechazados: string[];
};

/**
 * Detalle sanitizado del fallo.
 *
 * Se separa del mensaje humano a proposito. `EENVELOPE` de nodemailer NO
 * significa "el destinatario es invalido": cubre cualquier rechazo del sobre,
 * incluido el remitente y el relay. Traducirlo directamente como problema del
 * destinatario fue lo que hizo que 572 fallos apuntaran al sitio equivocado
 * mientras la respuesta real del servidor se tiraba a la basura.
 */
export function detalleSmtp(error: unknown): SmtpDetalle {
  const raw = error as
    | { response?: string; responseCode?: number; command?: string; rejected?: string[]; message?: string }
    | null;
  return {
    respuesta: raw?.response ? String(raw.response).slice(0, 300) : (raw?.message ? String(raw.message).slice(0, 300) : null),
    codigoSmtp: typeof raw?.responseCode === "number" ? raw.responseCode : null,
    etapa: raw?.command ? String(raw.command).slice(0, 40) : null,
    rechazados: Array.isArray(raw?.rejected) ? raw.rejected.map(String).slice(0, 10) : [],
  };
}

/**
 * Traduce los codigos de nodemailer/SMTP a un texto que el administrador pueda
 * accionar. El detalle tecnico completo va aparte, en `detalle`.
 */
export function describeSmtpError(error: unknown): { errorCode: string; error: string; detalle: SmtpDetalle } {
  const raw = error as { code?: string; responseCode?: number; message?: string } | null;
  const code = raw?.code ?? (raw?.responseCode ? `SMTP_${raw.responseCode}` : "SMTP_ERROR");
  const map: Record<string, string> = {
    EAUTH: "No se pudo autenticar con el servidor de correo. Revisa SMTP_USER y SMTP_PASSWORD.",
    ECONNECTION: "No se pudo conectar con el servidor de correo. Revisa SMTP_HOST y SMTP_PORT.",
    ECONNREFUSED: "El servidor de correo rechazó la conexión.",
    ETIMEDOUT: "El servidor de correo no respondió a tiempo.",
    ESOCKET: "La conexión segura con el servidor de correo falló.",
    // Deliberadamente NO dice "el destinatario es invalido": EENVELOPE tambien
    // se produce cuando el servidor rechaza al remitente o deniega el relay, y
    // afirmar de mas manda a revisar la direccion equivocada.
    EENVELOPE: "El servidor de correo rechazó el envío (remitente o destinatario). Revisa el detalle técnico para saber cuál.",
    EDNS: "No se pudo resolver el nombre del servidor de correo.",
  };
  return {
    errorCode: code.slice(0, 120),
    error: map[code] ?? "El servidor de correo rechazó el envío.",
    detalle: detalleSmtp(error),
  };
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
