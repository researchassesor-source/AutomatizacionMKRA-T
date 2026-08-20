import { NextResponse } from "next/server";
import { z } from "zod";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { automationRuleFields } from "@/lib/automation-rule-schema";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { courseAutomationWindow } from "@/lib/course-automation-window";
import { prisma } from "@/lib/db";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState } from "@/lib/nurture/course-reconciliation";
import { cancelIrreversibleMessages, quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";
import { CONTENIDO, GESTION } from "@/lib/auth/roles";

const updateSchema = automationRuleFields.partial().extend({ confirm: z.literal(true) });

/**
 * Campos cuyo cambio puede dejar un mensaje ya renderizado (cuerpo, momento,
 * canal, o el gate de enlace) desactualizado frente a lo que la regla dice
 * ahora. `enrollmentStatuses` entra también: cambia a quién le corresponde
 * el aviso, no solo el texto.
 */
const CAMPOS_QUE_AFECTAN_CONTENIDO = ["body", "subject", "trigger", "offsetMinutes", "requiresStreamUrl", "channel", "enrollmentStatuses"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.automationRule.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ error: "No se encontró la automatización." }, { status: 404 });
  const courseId = parsed.data.courseId ?? current.courseId;
  const course = await prisma.course.findUnique({ where: { id: courseId }, include: { sessions: { orderBy: { startAt: "asc" } } } });
  if (!course) return NextResponse.json({ error: "El curso seleccionado no existe." }, { status: 422 });
  const trigger = parsed.data.trigger ?? current.trigger;
  const offsetMinutes = parsed.data.offsetMinutes ?? current.offsetMinutes;
  const channel = parsed.data.channel ?? current.channel;
  const subject = parsed.data.subject !== undefined ? parsed.data.subject : current.subject;
  if (channel === "EMAIL" && !subject) return NextResponse.json({ error: "El asunto es obligatorio para correo." }, { status: 422 });
  const campaignId = parsed.data.campaignId !== undefined ? parsed.data.campaignId : current.campaignId;
  const campaign = campaignId ? await prisma.campaign.findUnique({ where: { id: campaignId } }) : null;
  if (campaignId && (!campaign || (campaign.courseId && campaign.courseId !== course.id))) {
    return NextResponse.json({ error: "La campaña no corresponde al curso." }, { status: 422 });
  }
  const { confirm: _confirm, ...data } = parsed.data;
  const window = courseAutomationWindow(course, course.sessions);
  const nextExecutionAt = nextFixedRuleExecution({ trigger, offsetMinutes, startsAt: window.startsAt, endsAt: window.endsAt });
  // Solo una activacion REAL (desde algo que no era ACTIVE) mueve activatedAt.
  // Reescribir texto u horario de una regla que ya estaba ACTIVE no la toca,
  // por la misma razon que este campo existe: no volver a colgar el guard de
  // bienvenida de una edicion cualquiera.
  const finalStatus = data.status ?? current.status;
  const activatingNow = finalStatus === "ACTIVE" && current.status !== "ACTIVE";
  const contentChanged = CAMPOS_QUE_AFECTAN_CONTENIDO.some(
    (campo) => data[campo] !== undefined && JSON.stringify(data[campo]) !== JSON.stringify(current[campo]),
  );

  /**
   * Cuarentena ANTES de guardar, en la misma transacción.
   *
   * A diferencia de course/link/session, aquí no hay un cerrojo de último
   * momento en sendMessage (no vuelve a comprobar el estado ni el contenido
   * de la regla al enviar): esta cuarentena es la ÚNICA protección contra que
   * un mensaje ya PROGRAMADO salga con el texto, horario, canal o gate de
   * enlace VIEJOS justo mientras se guarda la edición.
   */
  const rule = await prisma.$transaction(async (tx) => {
    if (finalStatus === "PAUSED") {
      // Pausa reversible: OMITIDO, no CANCELADO. Reactivar la regla vuelve a
      // llamar rescheduleCourseAutomations (mas abajo), que reprograma lo que
      // siga en el futuro por la misma via que MISSING_STREAM_URL/SCHEDULE_RECONCILING.
      await quarantineRecoverableMessages(
        tx,
        { automationRuleId: id },
        { errorCode: "RULE_PAUSED", errorMessage: "Este aviso se pausó porque la automatización se pausó. Se reanuda solo si vuelve a activarse, mientras siga en el futuro." },
      );
    } else if (finalStatus === "ARCHIVED") {
      // Archivar es un cierre, no una pausa: preserva historial pero no espera
      // recuperarse solo con un reschedule.
      await cancelIrreversibleMessages(
        tx,
        { automationRuleId: id },
        { errorCode: "AUTOMATION_DISABLED", errorMessage: "La automatización fue archivada." },
      );
    } else if (finalStatus === "ACTIVE" && contentChanged) {
      // Sigue (o queda) ACTIVE, pero cambió lo que decide qué sale y cuándo:
      // se recalcula, no se cancela.
      await quarantineRecoverableMessages(
        tx,
        { automationRuleId: id },
        { errorCode: "SCHEDULE_RECONCILING", errorMessage: "Esta automatización cambió y este aviso está esperando ser recalculado." },
      );
    }
    const actualizada = await tx.automationRule.update({
      where: { id },
      data: { ...data, campaignId, nextExecutionAt, ...(activatingNow ? { activatedAt: new Date() } : {}) },
    });
    // Mismo alcance que el recálculo de abajo: cualquier ACTIVE (edición o
    // activación) puede necesitar reconciliación, así que el flag persistente
    // cubre exactamente lo mismo que el intento real, nunca menos.
    if (actualizada.status === "ACTIVE") await markCourseAutomationReconcilePending(tx, actualizada.courseId, activatingNow ? "RULE_ACTIVATED" : "RULE_CONTENT_CHANGED");
    return actualizada;
  });

  // Activar o reescribir una regla debe reflejarse de inmediato en las
  // inscripciones vigentes; los mensajes ya enviados no se tocan. Si el
  // recálculo falla dos veces, el flag persistente (marcado arriba, en la
  // misma transacción) garantiza que el cron lo recupere.
  const reconciled = rule.status === "ACTIVE" ? await reconcileCourseDerivedState(rule.courseId, auth.session) : null;
  await writeAudit({ session: auth.session, action: "AUTOMATION_RULE_UPDATED", entityType: "AutomationRule", entityId: id, metadata: { status: rule.status, nextExecutionAt: rule.nextExecutionAt?.toISOString(), rescheduled: reconciled?.ok ? reconciled.rescheduled.enrollments : 0 } });
  return NextResponse.json({ ok: true, rule, pending: reconciled ? !reconciled.ok : false, reconciled });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, GESTION);
  if (auth.error) return auth.error;
  const body = await request.json().catch(() => null);
  if (body?.confirm !== "DELETE_AUTOMATION") return NextResponse.json({ error: "Falta la confirmación requerida." }, { status: 422 });
  const { id } = await params;
  const current = await prisma.automationRule.findUnique({ where: { id }, include: { _count: { select: { messages: true } } } });
  if (!current) return NextResponse.json({ error: "No se encontró la automatización." }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await cancelIrreversibleMessages(tx, { automationRuleId: id }, { errorCode: "AUTOMATION_DELETED", errorMessage: "La regla fue eliminada por un administrador." });
    if (current._count.messages === 0) await tx.automationRule.delete({ where: { id } });
    else await tx.automationRule.update({ where: { id }, data: { status: "ARCHIVED" } });
  });
  await writeAudit({ session: auth.session, action: "AUTOMATION_RULE_DELETED", entityType: "AutomationRule", entityId: id, metadata: { preservedHistory: current._count.messages > 0 } });
  return NextResponse.json({ ok: true, deleted: current._count.messages === 0, archived: current._count.messages > 0 });
}
