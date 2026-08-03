import { NextResponse } from "next/server";
import { z } from "zod";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { automationRuleFields } from "../route";

const updateSchema = automationRuleFields.partial().extend({ confirm: z.literal(true) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.automationRule.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No se encontró la automatización." }, { status: 404 });
  const courseId = parsed.data.courseId ?? current.courseId;
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) return NextResponse.json({ error: "El curso seleccionado no existe." }, { status: 422 });
  const trigger = parsed.data.trigger ?? current.trigger;
  const offsetMinutes = parsed.data.offsetMinutes ?? current.offsetMinutes;
  const { confirm: _confirm, ...data } = parsed.data;
  const nextExecutionAt = nextFixedRuleExecution({ trigger, offsetMinutes, startsAt: course.startsAt, endsAt: course.endsAt });
  const rule = await prisma.automationRule.update({ where: { id }, data: { ...data, campaignId: data.campaignId === "" ? null : data.campaignId, nextExecutionAt } });
  if (["PAUSED", "ARCHIVED"].includes(rule.status)) {
    await prisma.outboundMessage.updateMany({ where: { automationRuleId: id, status: "PROGRAMADO" }, data: { status: "CANCELADO", cancelledAt: new Date(), errorCode: "AUTOMATION_DISABLED", errorMessage: "La automatización fue pausada o archivada." } });
  }
  await writeAudit({ session: auth.session, action: "AUTOMATION_RULE_UPDATED", entityType: "AutomationRule", entityId: id, metadata: { status: rule.status, nextExecutionAt: rule.nextExecutionAt?.toISOString() } });
  return NextResponse.json({ ok: true, rule });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  if (body?.confirm !== "DELETE_AUTOMATION") return NextResponse.json({ error: "Falta la confirmación requerida." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.automationRule.findUnique({ where: { id }, include: { _count: { select: { messages: true } } } });
  if (!current) return NextResponse.json({ error: "No se encontró la automatización." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.outboundMessage.updateMany({ where: { automationRuleId: id, status: "PROGRAMADO" }, data: { status: "CANCELADO", cancelledAt: new Date(), errorCode: "AUTOMATION_DELETED", errorMessage: "La regla fue eliminada por un administrador." } });
    if (current._count.messages === 0) await tx.automationRule.delete({ where: { id } });
    else await tx.automationRule.update({ where: { id }, data: { status: "ARCHIVED" } });
  });
  await writeAudit({ session: auth.session, action: "AUTOMATION_RULE_DELETED", entityType: "AutomationRule", entityId: id, metadata: { preservedHistory: current._count.messages > 0 } });
  return NextResponse.json({ ok: true, deleted: current._count.messages === 0, archived: current._count.messages > 0 });
}
