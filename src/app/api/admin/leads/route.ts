import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { manualContactInputSchema } from "@/lib/leads";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;

  const parsed = manualContactInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }

  const input = parsed.data;
  const [course, assignee] = await Promise.all([
    input.courseId ? prisma.course.findFirst({ where: { id: input.courseId, isPublished: true }, select: { id: true } }) : null,
    input.assignedToId ? prisma.adminUser.findFirst({ where: { id: input.assignedToId, isActive: true }, select: { id: true } }) : null,
  ]);
  if (input.courseId && !course) {
    return NextResponse.json({ error: "El curso seleccionado no está disponible." }, { status: 422 });
  }
  if (input.assignedToId && !assignee) {
    return NextResponse.json({ error: "El responsable seleccionado no está disponible." }, { status: 422 });
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        source: input.source || "manual",
        assignedToId: assignee?.id,
        courseId: course?.id,
        consent: true,
        consentAt: now,
        consentPolicyVersion: "2026-07",
        consentPurpose: "Información de cursos y seguimiento comercial",
        stage: "NUEVO",
      },
    });
    await tx.leadEvent.create({
      data: {
        leadId: lead.id,
        type: "manual_contact_created",
        payload: { courseId: course?.id ?? null, source: input.source || null },
      },
    });
    return lead;
  });

  await writeAudit({
    session: auth.session,
    action: "LEAD_CREATED_MANUALLY",
    entityType: "Lead",
    entityId: result.id,
    metadata: { courseInterestId: course?.id ?? null },
  });

  return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
}
