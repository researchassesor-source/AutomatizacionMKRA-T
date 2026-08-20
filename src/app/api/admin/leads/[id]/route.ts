import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeEcuadorPhone } from "@/lib/leads";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";
import { quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";
import { recuperarAutomatizacionesDelContacto } from "@/lib/whatsapp/handoff-expiry";
import { COMERCIAL, TECNICO } from "@/lib/auth/roles";

const updateSchema = z.object({
  firstName: z.string().trim().min(2).max(80).optional(),
  lastName: z.string().trim().min(2).max(80).optional(),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().max(30).optional(),
  stage: z.enum(["NUEVO", "INSCRITO", "EN_CURSO", "CERTIFICADO", "OPORTUNIDAD", "CLIENTE", "PERDIDO"]).optional(),
  classification: z.enum(["REAL", "TEST", "DEMO", "UNKNOWN"]).optional(),
  assignedToId: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
  lostReason: z.string().trim().max(500).nullable().optional(),
  nextActionAt: z.string().datetime().nullable().optional(),
  confirm: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, COMERCIAL);
  if (auth.error) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });
  const changesSensitiveStage = parsed.data.stage !== undefined
    && parsed.data.stage !== current.stage
    && ["CLIENTE", "PERDIDO"].includes(parsed.data.stage);
  const changesArchive = parsed.data.isArchived !== undefined && parsed.data.isArchived !== current.isArchived;
  const changesClassification = parsed.data.classification !== undefined && parsed.data.classification !== current.classification;
  if ((changesSensitiveStage || changesArchive || changesClassification) && parsed.data.confirm !== true) {
    return NextResponse.json({ error: "Debes confirmar explícitamente esta acción." }, { status: 422 });
  }
  if (parsed.data.stage === "PERDIDO" && !parsed.data.lostReason) {
    return NextResponse.json({ error: "Indica el motivo de pérdida." }, { status: 422 });
  }

  let phone = parsed.data.phone;
  if (phone !== undefined) {
    try {
      phone = normalizeEcuadorPhone(phone);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 422 });
    }
  }
  const identityConflict = await prisma.lead.findFirst({
    where: {
      id: { not: id },
      OR: [
        ...(phone ? [{ phone }] : []),
        ...(parsed.data.email ? [{ email: parsed.data.email }] : []),
      ],
    },
    select: { id: true },
  });
  if (identityConflict) {
    return NextResponse.json({ error: "Ya existe otro contacto con ese WhatsApp o correo." }, { status: 409 });
  }
  const firstName = parsed.data.firstName ?? current.firstName;
  const lastName = parsed.data.lastName ?? current.lastName;
  const fullName = firstName && lastName ? `${firstName} ${lastName}` : current.fullName;
  const archivedChanged = parsed.data.isArchived !== undefined && parsed.data.isArchived !== current.isArchived;
  const updated = await prisma.lead.update({
    where: { id },
    data: {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: parsed.data.email,
      stage: parsed.data.stage,
      classification: parsed.data.classification,
      assignedToId: parsed.data.assignedToId,
      isArchived: parsed.data.isArchived,
      lostReason: parsed.data.stage && parsed.data.stage !== "PERDIDO" ? null : parsed.data.lostReason,
      phone,
      fullName,
      archivedAt: parsed.data.isArchived === true ? new Date() : parsed.data.isArchived === false ? null : undefined,
      nextActionAt: parsed.data.nextActionAt ? new Date(parsed.data.nextActionAt) : parsed.data.nextActionAt,
    },
  });
  if (parsed.data.stage && parsed.data.stage !== current.stage) {
    await prisma.leadEvent.create({
      data: { leadId: id, type: "stage_change", payload: { from: current.stage, to: parsed.data.stage } },
    });
  }
  /**
   * Archivar y reclasificar fuera de REAL detienen los recordatorios
   * pendientes, pero de forma RECUPERABLE (OMITIDO, no CANCELADO): restaurar
   * el contacto o volver a clasificarlo como REAL debe poder traerlos de
   * vuelta. El historial de lo ya enviado nunca se toca.
   */
  if (archivedChanged && updated.isArchived) {
    await quarantineRecoverableMessages(
      prisma,
      { leadId: id },
      { errorCode: "CONTACT_ARCHIVED", errorMessage: "El contacto fue archivado por un administrador." },
    );
  } else if (changesClassification && updated.classification !== "REAL") {
    await quarantineRecoverableMessages(
      prisma,
      { leadId: id },
      { errorCode: "CONTACT_EXCLUDED", errorMessage: "El contacto no está clasificado como real." },
    );
  }
  /**
   * Restaurar o volver a clasificar como REAL recupera lo que quedó
   * OMITIDO. `rescheduleCourseAutomations` (vía recuperarAutomatizacionesDelContacto)
   * ya rechaza por su cuenta a un contacto sin consentimiento o que sigue sin
   * ser REAL (CONTACT_EXCLUDED), así que no hace falta repetir esa condición
   * aquí: es seguro llamarlo siempre que la transición vaya en este sentido.
   * Nunca revive un momento que ya pasó de hora: eso lo protege el mismo
   * recálculo, no algo especial de este endpoint.
   */
  if ((archivedChanged && !updated.isArchived) || (changesClassification && updated.classification === "REAL")) {
    await recuperarAutomatizacionesDelContacto(id).catch(() => undefined);
  }
  await writeAudit({
    session: auth.session,
    action: archivedChanged
      ? (updated.isArchived ? "LEAD_ARCHIVED" : "LEAD_RESTORED")
      : changesClassification ? "LEAD_CLASSIFICATION_CHANGED" : "LEAD_UPDATED",
    entityType: "Lead",
    entityId: id,
  });
  return NextResponse.json({ ok: true, lead: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (body?.mode !== "delete-test" || body?.confirmName !== lead.fullName) {
    return NextResponse.json({ error: "La confirmación no coincide con el nombre del contacto." }, { status: 422 });
  }
  // Un contacto TEST o DEMO se borra con la confirmación del nombre. Uno REAL
  // representa a una persona que dejó sus datos, así que exige además un
  // reconocimiento explícito: no puede borrarse por inercia.
  const isReal = !["TEST", "DEMO"].includes(lead.classification);
  if (isReal && body?.acknowledgeRealDeletion !== true) {
    return NextResponse.json({
      error: "Este contacto está clasificado como real. Debes confirmar expresamente que quieres eliminarlo con todo su historial.",
      requiresRealAcknowledgement: true,
    }, { status: 409 });
  }
  await prisma.$transaction([
    prisma.lead.delete({ where: { id } }),
    prisma.auditLog.create({
      data: {
        actorId: auth.session?.userId ?? null,
        actorEmail: auth.session?.email ?? null,
        action: isReal ? "LEAD_DELETED" : "LEAD_TEST_DELETED",
        entityType: "Lead",
        entityId: id,
        result: "SUCCESS",
        metadata: { classification: lead.classification, email: lead.email, fullName: lead.fullName, wasReal: isReal, confirmed: true, cascadedRelatedData: true },
      },
    }),
  ]);
  return NextResponse.json({ ok: true, deleted: true });
}
