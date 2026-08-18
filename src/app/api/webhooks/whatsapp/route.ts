import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { applyMessageProviderEvent } from "@/lib/nurture/provider-events";
import { resolveWhatsAppConfig } from "@/lib/whatsapp/config";
import { handleInboundSupportReply } from "@/lib/whatsapp/inbound-reply";
import { guardarMensajeEntrante } from "@/lib/whatsapp/inbound-store";
import { parseWebhookPayload, resolveVerification, SIGNATURE_HEADER, verifySignature } from "@/lib/whatsapp/webhook";

export const dynamic = "force-dynamic";
// El cuerpo crudo es imprescindible para verificar la firma, y eso exige el
// runtime de Node: en Edge no hay `node:crypto`.
export const runtime = "nodejs";

/**
 * Webhook de WhatsApp Cloud API.
 *
 * GET  -> handshake de verificacion de Meta (hub.mode / hub.verify_token).
 * POST -> eventos de entrega y mensajes entrantes, firmados con el App Secret.
 *
 * Nada de lo que se registra aqui incluye el cuerpo del mensaje ni el numero
 * completo del contacto: la auditoria guarda contadores y codigos, no contenido.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const result = resolveVerification(
    {
      mode: url.searchParams.get("hub.mode"),
      token: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    },
    resolveWhatsAppConfig().verifyToken,
  );

  if (!result.ok) {
    await writeAudit({
      actorEmail: "whatsapp-webhook",
      action: "WHATSAPP_WEBHOOK_VERIFICATION_REJECTED",
      entityType: "Webhook",
      result: "FAILURE",
      metadata: { status: result.status, reason: result.error },
    }).catch(() => undefined);
    return new NextResponse(result.error, { status: result.status });
  }

  // Meta espera el challenge como texto plano, sin comillas ni JSON.
  return new NextResponse(result.challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const config = resolveWhatsAppConfig();
  const rawBody = await request.text();
  const signature = verifySignature(rawBody, request.headers.get(SIGNATURE_HEADER), config.appSecret);

  if (!signature.ok) {
    await writeAudit({
      actorEmail: "whatsapp-webhook",
      action: "WHATSAPP_WEBHOOK_SIGNATURE_REJECTED",
      entityType: "Webhook",
      result: "FAILURE",
      metadata: { reason: signature.reason, bodyLength: rawBody.length },
    }).catch(() => undefined);
    // 401 y no 403: lo que falla es la autenticacion de la peticion. Meta
    // reintenta, y eso es correcto mientras el secreto siga mal configurado.
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    await writeAudit({
      actorEmail: "whatsapp-webhook",
      action: "WHATSAPP_WEBHOOK_MALFORMED",
      entityType: "Webhook",
      result: "FAILURE",
      metadata: { bodyLength: rawBody.length },
    }).catch(() => undefined);
    // El cuerpo venia firmado pero no es JSON: reintentarlo daria el mismo
    // resultado, asi que se acusa recibo y se deja constancia.
    return NextResponse.json({ ok: true, ignored: "cuerpo no interpretable" }, { status: 200 });
  }

  const parsed = parseWebhookPayload(payload);
  let applied = 0;
  let unknownMessage = 0;
  let duplicated = 0;
  let inboundReplied = 0;
  let inboundRateLimited = 0;
  let inboundSelfIgnored = 0;
  let inboundNotLive = 0;
  let inboundInvalid = 0;
  let inboundFailed = 0;
  const inboundErrors = new Set<string>();

  for (const event of parsed.statuses) {
    try {
      const outcome = await applyMessageProviderEvent({
        provider: "whatsapp_cloud",
        providerMessageId: event.providerMessageId,
        providerEventId: event.providerEventId,
        state: event.state,
        occurredAt: event.occurredAt,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
        metadata: { source: "whatsapp_webhook", state: event.state },
      });
      if (!outcome.found) unknownMessage++;
      else if (outcome.duplicate) duplicated++;
      else if (outcome.changed) applied++;
    } catch {
      // Un evento problematico no puede tumbar el lote entero: Meta reintentaria
      // todos, incluidos los que ya se aplicaron correctamente.
      unknownMessage++;
    }
  }

  let inboundGuardados = 0;
  let inboundDuplicados = 0;
  let inboundSinNormalizar = 0;
  let inboundHandoff = 0;

  for (const notice of parsed.inbound) {
    /**
     * Persistir es lo primero y va aislado del resto.
     *
     * Si la respuesta automatica falla, el mensaje ya esta guardado y la
     * bandeja lo muestra igualmente; al reves seria peor, porque Meta
     * reintentaria el lote entero y el CRM perderia lo unico que no puede
     * reconstruir despues: lo que la persona escribio.
     */
    try {
      const guardado = await guardarMensajeEntrante(notice);
      if (guardado.estado === "guardado") {
        inboundGuardados++;
        if (guardado.handoffAbierto) inboundHandoff++;
      } else if (guardado.estado === "duplicado") inboundDuplicados++;
      else inboundSinNormalizar++;
    } catch {
      // Un mensaje problematico no puede tumbar los demas del mismo lote.
      inboundSinNormalizar++;
    }

    try {
      const outcome = await handleInboundSupportReply(notice);
      if (outcome.status === "sent") inboundReplied++;
      else if (outcome.status === "rate_limited") inboundRateLimited++;
      else if (outcome.status === "self_message") inboundSelfIgnored++;
      else if (outcome.status === "not_live") inboundNotLive++;
      else if (outcome.status === "send_failed") {
        inboundFailed++;
        inboundErrors.add(outcome.errorCode);
      } else {
        inboundInvalid++;
      }
    } catch {
      inboundFailed++;
      inboundErrors.add("WHATSAPP_INBOUND_EXCEPTION");
    }
  }

  // La auditoría conserva contadores y códigos técnicos; el contenido vive en
  // `inbound_messages`, que es donde la bandeja lo lee.
  if (parsed.inbound.length > 0) {
    await writeAudit({
      actorEmail: "whatsapp-webhook",
      action: "WHATSAPP_INBOUND_PROCESSED",
      entityType: "Webhook",
      metadata: {
        count: parsed.inbound.length,
        types: [...new Set(parsed.inbound.map((item) => item.type))],
        guardados: inboundGuardados,
        duplicados: inboundDuplicados,
        sinNormalizar: inboundSinNormalizar,
        handoffAbiertos: inboundHandoff,
        replied: inboundReplied,
        rateLimited: inboundRateLimited,
        selfIgnored: inboundSelfIgnored,
        notLive: inboundNotLive,
        invalid: inboundInvalid,
        failed: inboundFailed,
        errorCodes: [...inboundErrors],
      },
    }).catch(() => undefined);
  }

  if (parsed.statuses.length > 0 || parsed.ignoredFields.length > 0) {
    await writeAudit({
      actorEmail: "whatsapp-webhook",
      action: "WHATSAPP_WEBHOOK_PROCESSED",
      entityType: "Webhook",
      metadata: {
        statuses: parsed.statuses.length,
        applied,
        duplicated,
        unknownMessage,
        ignoredFields: parsed.ignoredFields,
      },
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    statuses: parsed.statuses.length,
    applied,
    duplicated,
    unknownMessage,
    inbound: parsed.inbound.length,
    inboundStored: inboundGuardados,
    inboundDuplicated: inboundDuplicados,
    inboundHandoff,
    inboundReplied,
    inboundRateLimited,
    inboundSelfIgnored,
    inboundNotLive,
    inboundInvalid,
    inboundFailed,
  });
}
