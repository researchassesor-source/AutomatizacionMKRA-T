import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { COMERCIAL } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import {
  describeScheduleResult,
  scheduleEnrollmentAutomations,
  type ScheduleAutomationsResult,
} from "@/lib/nurture/engine";

const schema = z.object({
  leadId: z.string().trim().min(1).max(100),
  courseId: z.string().trim().min(1).max(100),
  status: z.enum(["INTERESADO", "INSCRITO"]).default("INSCRITO"),
  confirm: z.literal(true),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, COMERCIAL);
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
    // La programación no puede deshacer una inscripción válida: si falla se
    // registra y queda pendiente de reprogramar desde el curso. Pero su
    // resultado no se descarta: la interfaz debe poder avisar si la inscripción
    // quedó creada sin ningún mensaje programado.
    let scheduling: ScheduleAutomationsResult | null = null;
    let schedulingFailed = false;
    try {
      scheduling = await scheduleEnrollmentAutomations(enrollment.id);
    } catch {
      schedulingFailed = true;
      await writeAudit({
        session: auth.session,
        action: "AUTOMATION_SCHEDULING_FAILED",
        entityType: "Enrollment",
        entityId: enrollment.id,
        result: "FAILURE",
        metadata: { courseId: course.id },
      });
    }
    if (scheduling?.reason) {
      await writeAudit({
        session: auth.session,
        action: "AUTOMATION_NO_MESSAGES_SCHEDULED",
        entityType: "Enrollment",
        entityId: enrollment.id,
        result: "FAILURE",
        metadata: { courseId: course.id, reason: scheduling.reason, activeRules: scheduling.activeRules },
      });
    }
    const warning = schedulingFailed
      ? "La inscripción se creó, pero no se pudieron programar los mensajes. Vuelve a guardar la sesión del curso para reprogramarlos."
      : scheduling
        ? describeScheduleResult(scheduling)
        : null;
    return NextResponse.json({
      ok: true,
      enrollmentId: enrollment.id,
      scheduling: scheduling
        ? {
            enqueued: scheduling.enqueued,
            updated: scheduling.updated,
            skipped: scheduling.skipped,
            omitted: scheduling.omitted,
            reason: scheduling.reason ?? null,
          }
        : { enqueued: 0, updated: 0, skipped: 0, omitted: 0, reason: "SCHEDULING_FAILED" },
      warning,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "El contacto ya está inscrito en este curso." }, { status: 409 });
    }
    return NextResponse.json({ error: "No se pudo crear la inscripción." }, { status: 500 });
  }
}
