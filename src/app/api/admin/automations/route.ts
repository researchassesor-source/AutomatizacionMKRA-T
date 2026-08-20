import { NextResponse } from "next/server";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { automationRuleSchema } from "@/lib/automation-rule-schema";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseAutomationWindow } from "@/lib/course-automation-window";
import { prisma } from "@/lib/db";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState } from "@/lib/nurture/course-reconciliation";
import { CONTENIDO } from "@/lib/auth/roles";

/**
 * Crear una regla ACTIVE debe reflejarse de inmediato en las inscripciones
 * ya existentes -antes esto nunca llamaba a nada que las recalculara, así
 * que una regla creada activa quedaba invisible para quien ya estaba
 * inscrito hasta que otra cosa tocara ese curso-. Una regla DRAFT no
 * necesita nada de esto: no envía a nadie todavía.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = automationRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const [course, campaign] = await Promise.all([
    prisma.course.findUnique({ where: { id: parsed.data.courseId }, include: { sessions: { orderBy: { startAt: "asc" } } } }),
    parsed.data.campaignId ? prisma.campaign.findUnique({ where: { id: parsed.data.campaignId } }) : null,
  ]);
  if (!course) return NextResponse.json({ error: "El curso seleccionado no existe." }, { status: 422 });
  if (parsed.data.campaignId && (!campaign || campaign.courseId && campaign.courseId !== course.id)) return NextResponse.json({ error: "La campaña no corresponde al curso." }, { status: 422 });
  const window = courseAutomationWindow(course, course.sessions);
  const nextExecutionAt = nextFixedRuleExecution({ trigger: parsed.data.trigger, offsetMinutes: parsed.data.offsetMinutes, startsAt: window.startsAt, endsAt: window.endsAt });

  const rule = await prisma.$transaction(async (tx) => {
    const creada = await tx.automationRule.create({ data: { ...parsed.data, campaignId: parsed.data.campaignId || null, nextExecutionAt, activatedAt: parsed.data.status === "ACTIVE" ? new Date() : null } });
    if (creada.status === "ACTIVE") await markCourseAutomationReconcilePending(tx, creada.courseId, "RULE_CREATED_ACTIVE");
    return creada;
  });
  await writeAudit({ session: auth.session, action: "AUTOMATION_RULE_CREATED", entityType: "AutomationRule", entityId: rule.id, metadata: { courseId: rule.courseId, trigger: rule.trigger, channel: rule.channel, status: rule.status } });
  const reconciled = rule.status === "ACTIVE" ? await reconcileCourseDerivedState(rule.courseId, auth.session) : null;
  return NextResponse.json({ ok: true, rule, pending: reconciled ? !reconciled.ok : false, reconciled }, { status: 201 });
}
