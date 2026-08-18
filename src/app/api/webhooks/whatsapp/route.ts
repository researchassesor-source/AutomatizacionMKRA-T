import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { applyMessageProviderEvent } from "@/lib/nurture/provider-events";
import { resolveWhatsAppConfig } from "@/lib/whatsapp/config";
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
  let inboundInvalidos = 0;
  let inboundHandoff = 0;
  /**
   * Un fallo de persistencia obliga a que Meta reintente el lote.
   *
   * Responder 200 con un mensaje sin guardar lo daria por entregado y el
   * contenido se perderia sin dejar rastro: es lo unico del webhook que no se
   * puede reconstruir despues. Como el wamid es unico, el reintento vuelve a
   * guardar solo el que falto y los demas quedan en duplicado seguro.
   */
  let fallosPersistencia = 0;
  const codigosPersistencia = new Set<string>();

  for (const notice of parsed.inbound) {
    // Se procesa el lote entero aunque uno falle: cortar aqui dejaria sin
    // guardar los que vienen detras y estan perfectamente bien.
    try {
      const guardado = await guardarMensajeEntrante(notice);
      if (guardado.estado === "guardado") {
        inboundGuardados++;
        if (guardado.handoffAbierto) inboundHandoff++;
      } else if (guardado.estado === "duplicado") {
        inboundDuplicados++;
      } else if (guardado.estado === "invalido") {
        // Definitivo: reintentarlo daria lo mismo, asi que no fuerza reintento.
        inboundInvalidos++;
      } else {
        fallosPersistencia++;
        codigosPersistencia.add(guardado.codigo);
      }
    } catch {
      fallosPersistencia++;
      codigosPersistencia.add("EXCEPCION_NO_CLASIFICADA");
    }
  }

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
        invalidos: inboundInvalidos,
        handoffAbiertos: inboundHandoff,
        fallosPersistencia,
        codigos: [...codigosPersistencia],
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

  const cuerpo = {
    statuses: parsed.statuses.length,
    applied,
    duplicated,
    unknownMessage,
    inbound: parsed.inbound.length,
    inboundStored: inboundGuardados,
    inboundDuplicated: inboundDuplicados,
    inboundInvalid: inboundInvalidos,
    inboundHandoff,
  };

  if (fallosPersistencia > 0) {
    // 503 y no 500: es una condicion temporal y se espera que Meta reintente.
    // El cuerpo no lleva contenido ni numeros, solo codigos tecnicos.
    return NextResponse.json(
      { ok: false, error: "No se pudo guardar parte del lote.", pendientes: fallosPersistencia, ...cuerpo },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, ...cuerpo });
}
