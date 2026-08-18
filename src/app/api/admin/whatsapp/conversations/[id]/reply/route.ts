import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import {
  canalListo,
  contextoValido,
  enviarRespuestaHumana,
  MAX_TEXTO_RESPUESTA,
  prepararEnvio,
  variablesDeContexto,
  ventanaDe,
} from "@/lib/whatsapp/conversation-service";

export const dynamic = "force-dynamic";

/**
 * Respuesta humana desde la bandeja.
 *
 * Todo lo que decide si el mensaje puede salir se comprueba aqui, no en la
 * interfaz: la ventana de 24 horas, que la plantilla este aprobada y que el
 * mensaje citado sea de esta conversacion. El panel puede ocultar un boton,
 * pero una peticion construida a mano llega igual.
 */
const schema = z.object({
  /**
   * Identidad de la peticion. Obligatoria: es lo que impide que un doble clic o
   * un reintento del navegador manden dos WhatsApps a la misma persona.
   */
  clientRequestId: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/),
  mode: z.enum(["text", "template"]),
  text: z.string().trim().max(MAX_TEXTO_RESPUESTA).optional(),
  templateKey: z.string().trim().max(80).optional(),
  enrollmentId: z.string().trim().max(40).optional(),
  replyToProviderMessageId: z.string().trim().max(120).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "whatsapp-reply"), { limit: 30, windowMs: 5 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Demasiadas respuestas seguidas. Espera unos segundos." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Petición no válida." }, { status: 422 });
  }
  const { id } = await params;

  const conversacion = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true, phone: true, leadId: true, lastInboundAt: true,
      lead: { select: { id: true, firstName: true, fullName: true } },
    },
  });
  if (!conversacion) return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });

  /**
   * Sin contacto vinculado no se responde.
   *
   * `OutboundMessage` cuelga de un lead, y crear uno aqui daria de alta a una
   * persona en el CRM como efecto colateral de contestarle. Se pide vincular
   * primero, que es una decision de quien administra.
   */
  if (!conversacion.leadId) {
    return NextResponse.json(
      { error: "Esta conversación no está vinculada a un contacto. Vincúlala antes de responder.", errorCode: "CONVERSATION_NOT_LINKED" },
      { status: 409 },
    );
  }

  const bloqueoCanal = canalListo();
  if (bloqueoCanal) {
    return NextResponse.json({ error: bloqueoCanal.mensaje, errorCode: bloqueoCanal.codigo }, { status: bloqueoCanal.estado });
  }

  // La inscripcion, solo si es de este contacto: aceptarla a ciegas dejaria
  // colgar el mensaje del historial de otra persona.
  let enrollmentId: string | null = null;
  if (parsed.data.enrollmentId) {
    const inscripcion = await prisma.enrollment.findFirst({
      where: { id: parsed.data.enrollmentId, leadId: conversacion.leadId },
      select: { id: true },
    });
    if (!inscripcion) return NextResponse.json({ error: "Esa inscripción no pertenece a este contacto.", errorCode: "ENROLLMENT_MISMATCH" }, { status: 422 });
    enrollmentId = inscripcion.id;
  }

  if (parsed.data.replyToProviderMessageId) {
    const valido = await contextoValido(conversacion.phone, parsed.data.replyToProviderMessageId);
    if (!valido) {
      return NextResponse.json({ error: "El mensaje citado no pertenece a esta conversación.", errorCode: "CONTEXT_FOREIGN" }, { status: 422 });
    }
  }

  const ventana = ventanaDe(conversacion.lastInboundAt);
  const contexto = enrollmentId
    ? await prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { course: { select: { title: true, whatsappGroupUrl: true, courseCompleteUrl: true, surveyUrl: true, streamUrl: true } } },
      })
    : null;

  const preparado = prepararEnvio({
    modo: parsed.data.mode,
    texto: parsed.data.text,
    templateKey: parsed.data.templateKey,
    ventanaAbierta: ventana.open,
    variables: variablesDeContexto({
      nombre: conversacion.lead?.firstName ?? conversacion.lead?.fullName,
      curso: contexto?.course.title,
      linkGrupo: contexto?.course.whatsappGroupUrl,
      linkCursoCompleto: contexto?.course.courseCompleteUrl,
      linkEncuesta: contexto?.course.surveyUrl,
      streamUrl: contexto?.course.streamUrl,
    }),
  });
  if (!preparado.ok) {
    return NextResponse.json({ error: preparado.fallo.mensaje, errorCode: preparado.fallo.codigo, window: ventana }, { status: preparado.fallo.estado });
  }

  const enviado = await enviarRespuestaHumana({
    conversationId: conversacion.id,
    conversationPhone: conversacion.phone,
    leadId: conversacion.leadId,
    enrollmentId,
    actorId: auth.session?.userId ?? null,
    clientRequestId: parsed.data.clientRequestId,
    cuerpo: preparado.cuerpo,
    template: preparado.template,
    replyToProviderMessageId: parsed.data.replyToProviderMessageId,
  });

  if (!enviado.ok) {
    await writeAudit({
      session: auth.session,
      action: "WHATSAPP_HUMAN_REPLY_SENT",
      entityType: "Conversation",
      entityId: conversacion.id,
      result: "FAILURE",
      // Ni el texto ni el numero: basta el codigo para entender que fallo.
      metadata: { modo: parsed.data.mode, errorCode: enviado.fallo.codigo },
    }).catch(() => undefined);
    return NextResponse.json({ error: enviado.fallo.mensaje, errorCode: enviado.fallo.codigo }, { status: enviado.fallo.estado });
  }

  if (!enviado.duplicado) {
    await writeAudit({
      session: auth.session,
      action: "WHATSAPP_HUMAN_REPLY_SENT",
      entityType: "Conversation",
      entityId: conversacion.id,
      result: "SUCCESS",
      metadata: { modo: parsed.data.mode, plantilla: parsed.data.templateKey ?? null, citado: Boolean(parsed.data.replyToProviderMessageId) },
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    // `duplicado` no es un error: es la misma petición contada una sola vez.
    duplicate: enviado.duplicado,
    messageId: enviado.outboundId,
    providerMessageId: enviado.providerMessageId,
    window: ventana,
  });
}
