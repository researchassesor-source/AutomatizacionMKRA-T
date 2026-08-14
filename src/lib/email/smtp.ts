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
  /** `error.response`: respuesta literal del servidor, p. ej. "550 5.7.1 Relay denied". */
  respuesta: string | null;
  /** `error.responseCode`: codigo numerico SMTP, cuando el servidor lo devuelve. */
  codigoSmtp: number | null;
  /** `error.command`: etapa en la que fallo (EHLO, AUTH, MAIL FROM, RCPT TO, DATA). */
  etapa: string | null;
  /** `error.message`: descripcion de nodemailer. Se guarda aparte de `respuesta`
   *  porque no siempre coinciden y la del servidor es la que manda. */
  mensaje: string | null;
  /** `error.rejected`: direcciones que el servidor rechazo. */
  rechazados: string[];
  /**
   * `error.rejectedErrors`: el motivo POR DESTINATARIO.
   *
   * Es lo que distingue "este buzon no existe" de "el relay esta denegado para
   * todos": si cada direccion trae su propio codigo, el problema es de esa
   * direccion; si todas traen el mismo, el problema es de la cuenta emisora.
   */
  erroresPorDestinatario: Array<{ destinatario: string | null; codigoSmtp: number | null; respuesta: string | null }>;
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
type ErrorSmtpCrudo = {
  response?: unknown;
  responseCode?: unknown;
  command?: unknown;
  rejected?: unknown;
  rejectedErrors?: unknown;
  message?: unknown;
};

/** Texto recortado, o null. Evita volcar respuestas enormes en la auditoria. */
function texto(valor: unknown, maximo: number): string | null {
  if (valor === undefined || valor === null) return null;
  const limpio = String(valor).trim();
  return limpio ? limpio.slice(0, maximo) : null;
}

export function detalleSmtp(error: unknown): SmtpDetalle {
  const raw = (error ?? null) as ErrorSmtpCrudo | null;
  const porDestinatario = Array.isArray(raw?.rejectedErrors) ? raw.rejectedErrors.slice(0, 10) : [];
  return {
    respuesta: texto(raw?.response, 300),
    codigoSmtp: typeof raw?.responseCode === "number" ? raw.responseCode : null,
    etapa: texto(raw?.command, 40),
    mensaje: texto(raw?.message, 300),
    rechazados: Array.isArray(raw?.rejected) ? raw.rejected.map((item) => String(item)).slice(0, 10) : [],
    erroresPorDestinatario: porDestinatario.map((item) => {
      const detalle = (item ?? {}) as { recipient?: unknown; responseCode?: unknown; response?: unknown };
      return {
        destinatario: texto(detalle.recipient, 254),
        codigoSmtp: typeof detalle.responseCode === "number" ? detalle.responseCode : null,
        respuesta: texto(detalle.response, 300),
      };
    }),
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
export async function verifySmtpConnection(
  settings: SmtpSettings,
): Promise<{ ok: boolean; errorCode?: string; error?: string; detalle?: SmtpDetalle }> {
  try {
    await getSmtpTransporter(settings).verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, ...describeSmtpError(error) };
  }
}
