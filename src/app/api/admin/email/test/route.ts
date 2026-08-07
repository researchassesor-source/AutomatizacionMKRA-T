import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { describeEmailConfig, formatSender, resolveEmailConfig } from "@/lib/email/config";
import { buildEmailDocument } from "@/lib/email/render";
import { sendSmtpEmail, verifySmtpConnection } from "@/lib/email/smtp";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { TECNICO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const schema = z.object({
  confirm: z.literal(true),
  /** Sin destinatario solo se comprueban las credenciales, sin enviar nada. */
  to: z.string().trim().email("La dirección de prueba no es válida.").max(254).optional(),
});

/**
 * Comprobacion controlada del correo institucional.
 *
 * Reservada a ADMIN y limitada por frecuencia: no es un canal de envio masivo.
 * Sin `to` solo verifica credenciales; con `to` envia un unico mensaje a una
 * direccion controlada por quien administra.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "email-test"), { limit: 5, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de pruebas de correo. Espera unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Debes confirmar la prueba." }, { status: 422 });
  }

  const config = resolveEmailConfig();
  const summary = describeEmailConfig(config);
  if (config.provider !== "smtp" || !config.smtp || !config.identity) {
    await writeAudit({ session: auth.session, action: "EMAIL_CONNECTION_TESTED", entityType: "EmailProvider", result: "FAILURE", metadata: { provider: summary.provider, reason: summary.reason } });
    return NextResponse.json({ ok: false, configuration: summary, error: summary.reason ?? "El proveedor SMTP no está configurado." }, { status: 422 });
  }

  const verification = await verifySmtpConnection(config.smtp);
  if (!verification.ok) {
    await writeAudit({ session: auth.session, action: "EMAIL_CONNECTION_TESTED", entityType: "EmailProvider", result: "FAILURE", metadata: { provider: "smtp", host: config.smtp.host, errorCode: verification.errorCode } });
    return NextResponse.json({ ok: false, configuration: summary, errorCode: verification.errorCode, error: verification.error }, { status: 502 });
  }

  if (!parsed.data.to) {
    await writeAudit({ session: auth.session, action: "EMAIL_CONNECTION_TESTED", entityType: "EmailProvider", result: "SUCCESS", metadata: { provider: "smtp", host: config.smtp.host, sent: false } });
    return NextResponse.json({ ok: true, verified: true, sent: false, configuration: summary, message: "Las credenciales del servidor de correo son válidas." });
  }

  const document = buildEmailDocument({
    subject: "Prueba de conexión · R.A. Training CRM",
    body: `Hola,

Este es un correo de prueba enviado desde el CRM de R.A. Training para confirmar la configuración del servidor de salida.

Remitente configurado: ${formatSender(config.identity)}
Servidor: ${config.smtp.host}

Si recibiste este mensaje, el envío automático está operativo.

R.A. Training`,
    brandName: config.identity.fromName,
    // Nadie se inscribió a nada: el pie debe decir que lo pidió un administrador.
    footer: "administrative_test",
  });
  const result = await sendSmtpEmail({ ...config, smtp: config.smtp }, { to: parsed.data.to, document });
  await writeAudit({
    session: auth.session,
    action: "EMAIL_TEST_SENT",
    entityType: "EmailProvider",
    result: result.ok ? "SUCCESS" : "FAILURE",
    metadata: { provider: "smtp", host: config.smtp.host, accepted: result.ok, errorCode: result.ok ? null : result.errorCode },
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, verified: true, sent: false, configuration: summary, errorCode: result.errorCode, error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, verified: true, sent: true, configuration: summary, message: "Correo de prueba enviado correctamente." });
}
