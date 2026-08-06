/**
 * Configuracion unica del correo saliente.
 *
 * El proyecto tenia una implementacion HTTP (Resend) detras de `EMAIL_API_KEY`.
 * El correo institucional de R.A. Training es SMTP en cPanel, asi que SMTP pasa
 * a ser el proveedor principal y Resend se conserva como respaldo para no
 * romper despliegues anteriores. No existen dos configuraciones paralelas: este
 * modulo es el unico punto que decide cual se usa.
 */
export type EmailProvider = "smtp" | "resend" | "none";

export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type EmailIdentity = {
  fromAddress: string;
  fromName: string;
  replyTo: string | null;
};

export type EmailConfig = {
  provider: EmailProvider;
  identity: EmailIdentity | null;
  smtp: SmtpSettings | null;
  resendApiKey: string | null;
  /** Motivo legible cuando el proveedor queda en "none". */
  reason: string | null;
};

const DEFAULT_FROM_NAME = "R.A. Training";

function value(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

function parsePort(raw: string | undefined, secureHint: boolean): number {
  const port = Number.parseInt(raw?.trim() ?? "", 10);
  if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
  return secureHint ? 465 : 587;
}

/**
 * `SMTP_SECURE` manda cuando esta definido. Si no lo esta se deduce del puerto:
 * 465 es SSL/TLS implicito; 587 usa STARTTLS y por eso va con secure=false.
 */
function parseSecure(raw: string | undefined, portRaw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return (portRaw?.trim() ?? "465") === "465";
}

/** Fuente de variables: `process.env` en ejecución, un objeto plano en pruebas. */
export type EnvSource = Record<string, string | undefined>;

export function resolveEmailConfig(env: EnvSource = process.env): EmailConfig {
  const fromAddress = value(env.EMAIL_FROM);
  const identity: EmailIdentity | null = fromAddress
    ? {
        fromAddress,
        fromName: value(env.EMAIL_FROM_NAME) ?? DEFAULT_FROM_NAME,
        replyTo: value(env.EMAIL_REPLY_TO) ?? fromAddress,
      }
    : null;

  const host = value(env.SMTP_HOST);
  const user = value(env.SMTP_USER);
  const password = value(env.SMTP_PASSWORD);
  const secure = parseSecure(env.SMTP_SECURE, env.SMTP_PORT);
  const smtp: SmtpSettings | null = host && user && password
    ? { host, port: parsePort(env.SMTP_PORT, secure), secure, user, password }
    : null;

  const resendApiKey = value(env.EMAIL_API_KEY);
  const declared = value(env.EMAIL_PROVIDER)?.toLowerCase();

  if (!identity) {
    return { provider: "none", identity: null, smtp, resendApiKey, reason: "Falta EMAIL_FROM." };
  }
  if (declared === "resend") {
    return resendApiKey
      ? { provider: "resend", identity, smtp, resendApiKey, reason: null }
      : { provider: "none", identity, smtp, resendApiKey: null, reason: "EMAIL_PROVIDER=resend pero falta EMAIL_API_KEY." };
  }
  if (declared === "smtp") {
    return smtp
      ? { provider: "smtp", identity, smtp, resendApiKey, reason: null }
      : { provider: "none", identity, smtp: null, resendApiKey, reason: "EMAIL_PROVIDER=smtp pero faltan SMTP_HOST, SMTP_USER o SMTP_PASSWORD." };
  }
  if (smtp) return { provider: "smtp", identity, smtp, resendApiKey, reason: null };
  if (resendApiKey) return { provider: "resend", identity, smtp: null, resendApiKey, reason: null };
  return { provider: "none", identity, smtp: null, resendApiKey: null, reason: "No hay credenciales SMTP ni EMAIL_API_KEY." };
}

/** Cabecera `From` completa: `R.A. Training <correo@dominio>`. */
export function formatSender(identity: EmailIdentity): string {
  return `${identity.fromName} <${identity.fromAddress}>`;
}

/**
 * Resumen apto para la interfaz administrativa. Nunca incluye la contraseña ni
 * la clave del proveedor: solo si estan presentes.
 */
export function describeEmailConfig(config: EmailConfig) {
  return {
    provider: config.provider,
    from: config.identity ? formatSender(config.identity) : null,
    replyTo: config.identity?.replyTo ?? null,
    host: config.smtp?.host ?? null,
    port: config.smtp?.port ?? null,
    secure: config.smtp?.secure ?? null,
    userConfigured: Boolean(config.smtp?.user),
    passwordConfigured: Boolean(config.smtp?.password),
    reason: config.reason,
  };
}
