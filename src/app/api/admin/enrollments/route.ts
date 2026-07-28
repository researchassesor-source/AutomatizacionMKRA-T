import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  leadId: z.string().trim().min(1).max(100),
  courseId: z.string().trim().min(1).max(100),
  status: z.enum(["INTERESADO", "INSCRITO"]).default("INSCRITO"),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "VENTAS"]);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de inscripción no válidos." }, { status: 422 });
  }

  const [lead, course] = await Promise.all([
    prisma.lead.findUnique({ where: { id: parsed.data.leadId }, select: { id: true, stage: true } }),
    prisma.course.findFirst({ where: { id: parsed.data.courseId, isPublished: true }, select: { id: true } }),
  ]);
  if (!lead) return NextResponse.json({ error: "No se encontró el contacto." }, { status: 404 });
  if (!course) return NextResponse.json({ error: "El curso no está disponible." }, { status: 422 });

  try {
    const enrollment = await prisma.$transaction(async (tx) => {
      const created = await tx.enrollment.create({
        data: {
          leadId: lead.id,
          courseId: course.id,
          status: parsed.data.status,
          source: "admin",
        },
      });
      await tx.leadEvent.create({
        data: {
          leadId: lead.id,
          enrollmentId: created.id,
          type: "enrollment_created",
          payload: { courseId: course.id, status: parsed.data.status },
        },
      });
      if (parsed.data.status === "INSCRITO" && lead.stage === "NUEVO") {
        await tx.lead.update({ where: { id: lead.id }, data: { stage: "INSCRITO" } });
      }
      return created;
    });
    await writeAudit({
      session: auth.session,
      action: "ENROLLMENT_CREATED",
      entityType: "Enrollment",
      entityId: enrollment.id,
      metadata: { leadId: lead.id, courseId: course.id },
    });
    return NextResponse.json({ ok: true, enrollmentId: enrollment.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "El contacto ya está inscrito en este curso." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo crear la inscripción." }, { status: 500 });
  }
}
