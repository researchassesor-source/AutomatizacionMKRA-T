import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeEcuadorPhone } from "@/lib/leads";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

const updateSchema = z.object({
  firstName: z.string().trim().min(2).max(80).optional(),
  lastName: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().max(30).optional(),
  stage: z.enum(["NUEVO", "INSCRITO", "EN_CURSO", "CERTIFICADO", "OPORTUNIDAD", "CLIENTE", "PERDIDO"]).optional(),
  assignedToId: z.string().nullable().optional(),
  isArchived: z.boolean().optional(),
  lostReason: z.string().trim().max(500).nullable().optional(),
  nextActionAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.lead.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });

  let phone = parsed.data.phone;
  if (phone !== undefined) {
    try {
      phone = normalizeEcuadorPhone(phone);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 422 });
    }
  }
  const firstName = parsed.data.firstName ?? current.firstName;
  const lastName = parsed.data.lastName ?? current.lastName;
  const fullName = firstName && lastName ? `${firstName} ${lastName}` : current.fullName;
  const archivedChanged = parsed.data.isArchived !== undefined && parsed.data.isArchived !== current.isArchived;
  const updated = await prisma.lead.update({
    where: { id },
    data: {
      ...parsed.data,
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
  await writeAudit({
    session: auth.session,
    action: archivedChanged ? (updated.isArchived ? "LEAD_ARCHIVED" : "LEAD_RESTORED") : "LEAD_UPDATED",
    entityType: "Lead",
    entityId: id,
  });
  return NextResponse.json({ ok: true, lead: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  const { id } = await params;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (body?.confirmName !== lead.fullName) {
    return NextResponse.json({ error: "La confirmación no coincide con el nombre del contacto." }, { status: 422 });
  }
  const [enrollments, messages, followUps] = await Promise.all([
    prisma.enrollment.count({ where: { leadId: id } }),
    prisma.outboundMessage.count({ where: { leadId: id } }),
    prisma.followUp.count({ where: { leadId: id } }),
  ]);
  if (enrollments > 0 || messages > 0 || followUps > 0) {
    return NextResponse.json(
      { error: "El contacto conserva historial operativo. Archívalo en lugar de eliminarlo." },
      { status: 409 },
    );
  }
  await writeAudit({
    session: auth.session,
    action: "LEAD_DELETED",
    entityType: "Lead",
    entityId: id,
    metadata: { confirmed: true },
  });
  await prisma.lead.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
