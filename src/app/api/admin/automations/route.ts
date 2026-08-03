import { NextResponse } from "next/server";
import { z } from "zod";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";

export const automationRuleFields = z.object({
  courseId: z.string().min(1),
  campaignId: z.string().nullable().optional(),
  name: z.string().trim().min(3).max(140),
  trigger: z.enum(["ON_REGISTRATION", "BEFORE_COURSE", "AFTER_COURSE"]),
  offsetMinutes: z.coerce.number().int().min(0).max(525_600),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(5).max(10_000),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  enrollmentStatuses: z.array(z.enum(["INTERESADO", "INSCRITO", "EN_CURSO", "COMPLETADO", "CANCELADO"])).min(1).default(["INTERESADO", "INSCRITO"]),
});

export const automationRuleSchema = automationRuleFields.refine((value) => value.channel !== "EMAIL" || Boolean(value.subject), { message: "El asunto es obligatorio para correo." });

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = automationRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const [course, campaign] = await Promise.all([
    prisma.course.findUnique({ where: { id: parsed.data.courseId } }),
    parsed.data.campaignId ? prisma.campaign.findUnique({ where: { id: parsed.data.campaignId } }) : null,
  ]);
  if (!course) return NextResponse.json({ error: "El curso seleccionado no existe." }, { status: 422 });
  if (parsed.data.campaignId && (!campaign || campaign.courseId && campaign.courseId !== course.id)) return NextResponse.json({ error: "La campaña no corresponde al curso." }, { status: 422 });
  const nextExecutionAt = nextFixedRuleExecution({ trigger: parsed.data.trigger, offsetMinutes: parsed.data.offsetMinutes, startsAt: course.startsAt, endsAt: course.endsAt });
  const rule = await prisma.automationRule.create({ data: { ...parsed.data, campaignId: parsed.data.campaignId || null, nextExecutionAt } });
  await writeAudit({ session: auth.session, action: "AUTOMATION_RULE_CREATED", entityType: "AutomationRule", entityId: rule.id, metadata: { courseId: rule.courseId, trigger: rule.trigger, channel: rule.channel, status: rule.status } });
  return NextResponse.json({ ok: true, rule }, { status: 201 });
}
