import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { courseCompletionMoment, resolveCourseSessions } from "@/lib/course-sessions";
import { prisma } from "@/lib/db";
import { DEFAULT_AUTOMATION_PLAN } from "@/lib/nurture/default-automations";

const schema = z.object({
  courseId: z.string().trim().min(1, "Selecciona un curso."),
  /** true deja las reglas listas para enviar; false las crea como borrador. */
  activate: z.boolean().default(false),
});

/**
 * Aplica el plan estandar de cinco correos a un curso.
 *
 * Es idempotente gracias a `planKey`: reaplicarlo no duplica reglas y respeta
 * el contenido que el administrador haya editado (solo completa lo que falta).
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });

  const course = await prisma.course.findUnique({
    where: { id: parsed.data.courseId },
    include: { sessions: { orderBy: { startAt: "asc" } } },
  });
  if (!course) return NextResponse.json({ error: "El curso seleccionado no existe." }, { status: 422 });

  const sessions = resolveCourseSessions(course, course.sessions);
  const startsAt = sessions[0]?.startAt ?? course.startsAt;
  const endsAt = courseCompletionMoment(sessions) ?? course.endsAt;

  const existing = await prisma.automationRule.findMany({
    where: { courseId: course.id, planKey: { not: null } },
    select: { id: true, planKey: true, status: true },
  });
  const byPlanKey = new Map(existing.map((rule) => [rule.planKey, rule]));

  let created = 0;
  let activated = 0;
  for (const entry of DEFAULT_AUTOMATION_PLAN) {
    const current = byPlanKey.get(entry.planKey);
    const status = parsed.data.activate ? ("ACTIVE" as const) : ("DRAFT" as const);
    const nextExecutionAt = nextFixedRuleExecution({ trigger: entry.trigger, offsetMinutes: entry.offsetMinutes, startsAt, endsAt });
    if (!current) {
      await prisma.automationRule.create({
        data: {
          courseId: course.id,
          planKey: entry.planKey,
          name: entry.name,
          trigger: entry.trigger,
          offsetMinutes: entry.offsetMinutes,
          channel: "EMAIL",
          subject: entry.subject,
          body: entry.body,
          status,
          requiresStreamUrl: entry.requiresStreamUrl,
          enrollmentStatuses: entry.enrollmentStatuses,
          nextExecutionAt,
        },
      });
      created++;
      continue;
    }
    // El contenido editado por el administrador no se sobrescribe: solo se
    // reactiva la regla si asi se solicito.
    if (parsed.data.activate && current.status !== "ACTIVE") {
      await prisma.automationRule.update({ where: { id: current.id }, data: { status: "ACTIVE", nextExecutionAt } });
      activated++;
    }
  }

  await writeAudit({
    session: auth.session,
    action: "AUTOMATION_PLAN_APPLIED",
    entityType: "Course",
    entityId: course.id,
    metadata: { created, activated, requested: DEFAULT_AUTOMATION_PLAN.length, activate: parsed.data.activate },
  });
  return NextResponse.json({
    ok: true,
    created,
    activated,
    unchanged: DEFAULT_AUTOMATION_PLAN.length - created - activated,
    message: created === 0 && activated === 0
      ? "El curso ya tenía el plan de correos aplicado."
      : `Plan aplicado: ${created} reglas nuevas y ${activated} reactivadas.`,
  });
}
