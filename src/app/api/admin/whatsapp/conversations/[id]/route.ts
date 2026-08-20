import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { GESTION, OPERACION } from "@/lib/auth/roles";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { ventanaDe } from "@/lib/whatsapp/conversation-service";
import { recuperarAutomatizacionesDelContacto } from "@/lib/whatsapp/handoff-expiry";

export const dynamic = "force-dynamic";

/** Tope duro: una conversacion larga no puede traerse entera de una vez. */
const MAX_MENSAJES = 100;

/**
 * Detalle de una conversacion y acciones sobre ella.
 *
 * El historial mezcla dos tablas —lo que entra y lo que sale— en una sola
 * lista ordenada por tiempo, que es como se lee una conversacion. Cada entrada
 * dice de donde viene: del contacto, de un asesor o de una automatizacion.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;
  const { id } = await params;

  const conversacion = await prisma.conversation.findUnique({
    where: { id },
    select: {
      id: true, phone: true, state: true, lastInboundAt: true, lastOutboundAt: true,
      handoffAt: true, resolvedAt: true, assignedToId: true,
      assignedTo: { select: { id: true, name: true } },
      lead: {
        select: {
          id: true, fullName: true, email: true,
          enrollments: {
            select: { id: true, status: true, course: { select: { id: true, title: true } } },
            orderBy: { createdAt: "desc" },
            take: 10,
          },
        },
      },
    },
  });
  if (!conversacion) return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });

  const [entrantes, salientes] = await Promise.all([
    prisma.inboundMessage.findMany({
      where: { fromPhone: conversacion.phone },
      select: { id: true, type: true, text: true, mediaMeta: true, contextMessageId: true, occurredAt: true, readAt: true, providerMessageId: true },
      orderBy: { occurredAt: "desc" },
      take: MAX_MENSAJES,
    }),
    prisma.outboundMessage.findMany({
      where: {
        channel: "WHATSAPP",
        // De la conversacion, o del contacto vinculado: los automaticos son
        // anteriores a que existiera la conversacion y no la referencian.
        OR: [{ conversationId: id }, ...(conversacion.lead ? [{ leadId: conversacion.lead.id }] : [])],
      },
      select: {
        id: true, body: true, status: true, origin: true, scheduledAt: true, acceptedAt: true,
        errorCode: true, providerMessageId: true,
        humanActor: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: "desc" },
      take: MAX_MENSAJES,
    }),
  ]);

  const historial = [
    ...entrantes.map((m) => ({
      id: m.id,
      direction: "INBOUND" as const,
      origin: "CONTACT" as const,
      at: m.occurredAt.toISOString(),
      type: m.type,
      text: m.text,
      // Solo metadatos: nunca el archivo ni el payload del proveedor.
      attachment: m.mediaMeta ?? null,
      replyTo: m.contextMessageId,
      read: Boolean(m.readAt),
      status: null,
      actor: null,
    })),
    ...salientes.map((m) => ({
      id: m.id,
      direction: "OUTBOUND" as const,
      origin: m.origin === "HUMAN" ? ("HUMAN" as const) : ("AUTOMATION" as const),
      at: (m.acceptedAt ?? m.scheduledAt).toISOString(),
      type: "text",
      text: m.body,
      attachment: null,
      replyTo: null,
      read: m.status === "LEIDO",
      status: m.status,
      actor: m.humanActor?.name ?? null,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return NextResponse.json({
    ok: true,
    conversation: {
      id: conversacion.id,
      phone: conversacion.phone,
      state: conversacion.state,
      handoffAt: conversacion.handoffAt?.toISOString() ?? null,
      resolvedAt: conversacion.resolvedAt?.toISOString() ?? null,
      assignedTo: conversacion.assignedTo,
      linked: Boolean(conversacion.lead),
      lead: conversacion.lead
        ? { id: conversacion.lead.id, name: conversacion.lead.fullName, email: conversacion.lead.email, enrollments: conversacion.lead.enrollments }
        : null,
    },
    window: ventanaDe(conversacion.lastInboundAt),
    messages: historial,
    truncated: entrantes.length === MAX_MENSAJES || salientes.length === MAX_MENSAJES,
  });
}

const patchSchema = z.object({
  leadId: z.string().trim().min(1).max(40).nullable().optional(),
  assignedToId: z.string().trim().min(1).max(40).nullable().optional(),
  state: z.enum(["HUMAN_HANDOFF", "RESOLVED"]).optional(),
  /**
   * Confirmación explícita de "el contacto tiene otro número, úsalo y
   * vincula" (sección W). Sin esto, un teléfono que no coincide se rechaza
   * como hasta ahora (PHONE_MISMATCH): esto NUNCA es el comportamiento por
   * defecto, hace falta un clic aparte.
   */
  confirmPhoneUpdate: z.literal(true).optional(),
}).refine((v) => v.leadId !== undefined || v.assignedToId !== undefined || v.state !== undefined, {
  message: "No hay nada que cambiar.",
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Vincular un contacto y reasignar son decisiones de gestion, no de atencion.
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "whatsapp-conversation-patch"), { limit: 60, windowMs: 5 * 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "Demasiadas peticiones seguidas." }, { status: 429 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Petición no válida." }, { status: 422 });

  const { id } = await params;
  const conversacion = await prisma.conversation.findUnique({ where: { id }, select: { id: true, phone: true, leadId: true, assignedToId: true, state: true } });
  if (!conversacion) return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });

  /**
   * "Usar este nuevo número y vincular" (sección W): acción propia y
   * aislada, no una variante del vínculo normal. Toca DOS tablas (Lead y
   * Conversation) de forma atómica, así que vive fuera del acumulador
   * genérico `data` de más abajo, que solo escribe Conversation.
   */
  if (parsed.data.leadId && parsed.data.confirmPhoneUpdate) {
    const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true, phone: true } });
    if (!lead) return NextResponse.json({ error: "Ese contacto no existe.", errorCode: "LEAD_NOT_FOUND" }, { status: 422 });
    if (lead.phone === conversacion.phone) {
      // Ya coincidía: nada que confirmar, se trata como un vínculo normal.
    } else {
      const otroDueño = await prisma.lead.findFirst({ where: { phone: conversacion.phone, id: { not: lead.id } }, select: { id: true } });
      if (otroDueño) {
        return NextResponse.json({ error: "Ese número de WhatsApp ya pertenece a otro contacto.", errorCode: "PHONE_CLAIMED_BY_ANOTHER_LEAD" }, { status: 409 });
      }
      await prisma.$transaction([
        // El consentimiento y la clasificación NUNCA se tocan aquí: cambiar el
        // número no es lo mismo que consentir de nuevo.
        prisma.lead.update({ where: { id: lead.id }, data: { phone: conversacion.phone } }),
        prisma.conversation.update({ where: { id }, data: { leadId: lead.id } }),
        prisma.inboundMessage.updateMany({ where: { fromPhone: conversacion.phone, leadId: null }, data: { leadId: lead.id } }),
      ]);
      await writeAudit({
        session: auth.session,
        action: "WHATSAPP_CONTACT_PHONE_UPDATED",
        entityType: "Lead",
        entityId: lead.id,
        // Nunca el número viejo ni el nuevo en claro: un log de auditoría no
        // es el lugar para un teléfono completo. `conversationId` ya basta
        // para reconstruir el caso si hace falta investigarlo.
        metadata: { conversationId: id, telefonoActualizado: true },
      }).catch(() => undefined);
      return NextResponse.json({ ok: true, changed: true });
    }
  }

  const data: Record<string, unknown> = {};

  if (parsed.data.leadId !== undefined) {
    if (parsed.data.leadId === null) {
      data.leadId = null;
    } else {
      const lead = await prisma.lead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true, phone: true } });
      if (!lead) return NextResponse.json({ error: "Ese contacto no existe.", errorCode: "LEAD_NOT_FOUND" }, { status: 422 });
      /**
       * El telefono tiene que ser el mismo.
       *
       * Vincular una conversacion a un contacto con otro numero mezclaria el
       * historial de dos personas, y ademas la respuesta saldria hacia el
       * numero de la conversacion mientras el CRM cree que habla con otra.
       * Si no coinciden, la salida es "confirmPhoneUpdate" (arriba), nunca
       * un vínculo silencioso.
       */
      if (lead.phone !== conversacion.phone) {
        return NextResponse.json({ error: "El teléfono de ese contacto no coincide con el de la conversación.", errorCode: "PHONE_MISMATCH" }, { status: 422 });
      }
      data.leadId = lead.id;
    }
  }

  if (parsed.data.assignedToId !== undefined) {
    if (parsed.data.assignedToId === null) {
      data.assignedToId = null;
    } else {
      const admin = await prisma.adminUser.findFirst({ where: { id: parsed.data.assignedToId, isActive: true }, select: { id: true } });
      if (!admin) return NextResponse.json({ error: "Ese usuario no existe o está inactivo.", errorCode: "ADMIN_INVALID" }, { status: 422 });
      data.assignedToId = admin.id;
    }
  }

  if (parsed.data.state === "RESOLVED") {
    data.state = "RESOLVED";
    data.resolvedAt = new Date();
    data.resolvedBy = auth.session?.email ?? "admin";
  } else if (parsed.data.state === "HUMAN_HANDOFF") {
    data.state = "HUMAN_HANDOFF";
    data.handoffAt = new Date();
    data.handoffBy = auth.session?.email ?? "admin";
  }

  // Idempotente: si nada cambia de valor, no se escribe ni se audita.
  const cambios = Object.entries(data).filter(([clave, valor]) => (conversacion as Record<string, unknown>)[clave] !== valor);
  if (cambios.length === 0) return NextResponse.json({ ok: true, changed: false });

  await prisma.conversation.update({ where: { id }, data });

  if (data.leadId !== undefined) {
    // Los entrantes de este numero que quedaron sin contacto pasan a tenerlo.
    // No se toca `consent` ni `classification`: vincular no es consentir.
    if (typeof data.leadId === "string") {
      await prisma.inboundMessage.updateMany({ where: { fromPhone: conversacion.phone, leadId: null }, data: { leadId: data.leadId } });
    }
    await writeAudit({ session: auth.session, action: "WHATSAPP_CONVERSATION_LINKED", entityType: "Conversation", entityId: id, metadata: { vinculado: Boolean(data.leadId) } }).catch(() => undefined);
  }
  if (data.assignedToId !== undefined) {
    await writeAudit({ session: auth.session, action: "WHATSAPP_CONVERSATION_ASSIGNED", entityType: "Conversation", entityId: id, metadata: { asignado: Boolean(data.assignedToId) } }).catch(() => undefined);
  }
  if (parsed.data.state) {
    await writeAudit({
      session: auth.session,
      action: parsed.data.state === "RESOLVED" ? "WHATSAPP_HANDOFF_RESOLVED" : "WHATSAPP_HANDOFF_STARTED",
      entityType: "Conversation",
      entityId: id,
      metadata: { desde: conversacion.state },
    }).catch(() => undefined);
  }

  /**
   * Cerrar la atencion no reactivaba sola lo comercial que se habia callado
   * mientras duro: se quedaba OMITIDO/HUMAN_HANDOFF_ACTIVE para siempre hasta
   * que algo mas tocara ese curso por otro motivo. El asesor que cierra la
   * conversacion espera que el contacto vuelva a recibir sus automatizaciones.
   */
  if (parsed.data.state === "RESOLVED") {
    const leadId = data.leadId !== undefined ? (data.leadId as string | null) : conversacion.leadId;
    if (leadId) await recuperarAutomatizacionesDelContacto(leadId).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, changed: true });
}
