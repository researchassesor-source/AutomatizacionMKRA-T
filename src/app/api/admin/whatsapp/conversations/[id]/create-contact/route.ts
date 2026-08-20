import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { GESTION } from "@/lib/auth/roles";
import { normalizeEmail } from "@/lib/lead-validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  fullName: z.string().trim().min(2, "Ingresa el nombre completo.").max(160).regex(/^[\p{L}\p{M}\s.'-]+$/u, "El nombre contiene caracteres no válidos."),
  email: z.preprocess(
    (value) => typeof value === "string" ? value.trim() : "",
    z.union([z.literal(""), z.string().email("El correo electrónico no es válido.").max(254)]),
  ).transform(normalizeEmail),
  courseId: z.string().trim().max(100).optional().or(z.literal("")),
  assignedToId: z.string().trim().max(100).optional().or(z.literal("")),
  confirm: z.literal(true),
});

/**
 * Crea un contacto NUEVO a partir de una conversación de WhatsApp entrante
 * sin vincular (sección V del release de estabilización).
 *
 * El teléfono NUNCA lo manda el cliente: es el de la conversación, tomado
 * del servidor, precisamente para que no pueda haber un desajuste como el
 * que sí puede pasar al vincular uno YA existente (sección W).
 *
 * consent SIEMPRE queda en false: que alguien escriba por WhatsApp no es
 * consentir marketing. Eso es lo único que impide que entre en
 * automatizaciones comerciales (isAutomationEligibleContact ya lo exige en
 * todo el motor) -- pero SÍ puede recibir una respuesta humana dentro de la
 * ventana, porque fue la propia persona quien empezó la conversación.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });

  const { id } = await params;
  const conversacion = await prisma.conversation.findUnique({ where: { id }, select: { id: true, phone: true, leadId: true } });
  if (!conversacion) return NextResponse.json({ error: "No se encontró la conversación." }, { status: 404 });
  if (conversacion.leadId) return NextResponse.json({ error: "Esta conversación ya está vinculada a un contacto.", errorCode: "ALREADY_LINKED" }, { status: 409 });

  const [course, assignee, existente] = await Promise.all([
    parsed.data.courseId ? prisma.course.findFirst({ where: { id: parsed.data.courseId, isPublished: true }, select: { id: true } }) : null,
    parsed.data.assignedToId ? prisma.adminUser.findFirst({ where: { id: parsed.data.assignedToId, isActive: true }, select: { id: true } }) : null,
    prisma.lead.findFirst({ where: { phone: conversacion.phone }, select: { id: true } }),
  ]);
  if (parsed.data.courseId && !course) return NextResponse.json({ error: "El curso seleccionado no está disponible." }, { status: 422 });
  if (parsed.data.assignedToId && !assignee) return NextResponse.json({ error: "El responsable seleccionado no está disponible." }, { status: 422 });
  /**
   * Ya existe alguien con este número: no se crea un duplicado en silencio.
   * Quien administra eligió "Crear nuevo" a propósito, así que se le devuelve
   * el conflicto explícito en vez de vincularlo a un contacto distinto del
   * que pensaba estar creando.
   */
  if (existente) {
    return NextResponse.json({ error: "Ya existe un contacto con este número. Búscalo en «Contacto existente».", errorCode: "PHONE_ALREADY_REGISTERED" }, { status: 409 });
  }

  const lead = await prisma.$transaction(async (tx) => {
    const nuevo = await tx.lead.create({
      data: {
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        phone: conversacion.phone,
        source: "whatsapp_inbound",
        courseId: course?.id,
        assignedToId: assignee?.id,
        consent: false,
        classification: "REAL",
        stage: "NUEVO",
      },
    });
    await tx.conversation.update({ where: { id }, data: { leadId: nuevo.id } });
    await tx.inboundMessage.updateMany({ where: { fromPhone: conversacion.phone, leadId: null }, data: { leadId: nuevo.id } });
    await tx.leadEvent.create({
      data: { leadId: nuevo.id, type: "whatsapp_contact_created", payload: { conversationId: id, courseId: course?.id ?? null } },
    });
    return nuevo;
  });

  await writeAudit({
    session: auth.session,
    action: "WHATSAPP_CONTACT_CREATED",
    entityType: "Lead",
    entityId: lead.id,
    metadata: { conversationId: id, courseInterestId: course?.id ?? null, consent: false },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
