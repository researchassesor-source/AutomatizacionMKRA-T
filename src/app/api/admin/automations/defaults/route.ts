import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { courseCompletionMoment, resolveCourseSessions } from "@/lib/course-sessions";
import { prisma } from "@/lib/db";
import { DEFAULT_AUTOMATION_PLAN } from "@/lib/nurture/default-automations";
import { templateFieldsFor, WHATSAPP_AUTOMATION_PLAN } from "@/lib/nurture/default-automations-whatsapp";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { CONTENIDO } from "@/lib/auth/roles";

const schema = z.object({
  courseId: z.string().trim().min(1, "Selecciona un curso."),
  /** true deja las reglas listas para enviar; false las crea como borrador. */
  activate: z.boolean().default(false),
  /**
   * Canal del plan. Por omisión el correo, que es como se comportaba antes de
   * que existiera el plan de WhatsApp: quien ya llamaba a este endpoint sigue
   * obteniendo exactamente lo mismo.
   */
  channel: z.enum(["EMAIL", "WHATSAPP"]).default("EMAIL"),
});

type PlanEntry = {
  planKey: string;
  name: string;
  trigger: "ON_REGISTRATION" | "BEFORE_COURSE" | "AFTER_COURSE";
  offsetMinutes: number;
  subject: string | null;
  body: string;
  requiresStreamUrl: boolean;
  enrollmentStatuses: string[];
  waTemplateName: string | null;
  waTemplateLanguage: string | null;
  waTemplateBodyVars: string[] | null;
  waTemplateUrlVar: string | null;
};

function planFor(channel: "EMAIL" | "WHATSAPP"): PlanEntry[] {
  if (channel === "EMAIL") {
    return DEFAULT_AUTOMATION_PLAN.map((entry) => ({
      planKey: entry.planKey,
      name: entry.name,
      trigger: entry.trigger,
      offsetMinutes: entry.offsetMinutes,
      subject: entry.subject,
      body: entry.body,
      requiresStreamUrl: entry.requiresStreamUrl,
      enrollmentStatuses: entry.enrollmentStatuses,
      waTemplateName: null,
      waTemplateLanguage: null,
      waTemplateBodyVars: null,
      waTemplateUrlVar: null,
    }));
  }
  return WHATSAPP_AUTOMATION_PLAN.map((entry) => {
    const template = templateFieldsFor(entry);
    return {
      planKey: entry.planKey,
      name: entry.name,
      trigger: entry.trigger,
      offsetMinutes: entry.offsetMinutes,
      // WhatsApp no tiene asunto: dejarlo con texto seria un campo muerto que
      // ademas confundiria al diagnostico de reglas pausadas.
      subject: null,
      body: entry.body,
      requiresStreamUrl: entry.requiresStreamUrl,
      enrollmentStatuses: entry.enrollmentStatuses,
      ...template,
    };
  });
}

/**
 * Aplica el plan estandar de cinco pasos a un curso, en el canal indicado.
 *
 * Es idempotente gracias a `planKey` combinado con el canal: reaplicarlo no
 * duplica reglas y respeta el contenido que el administrador haya editado
 * (solo completa lo que falta).
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
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
  const channel = parsed.data.channel;
  const plan = planFor(channel);

  const existing = await prisma.automationRule.findMany({
    where: { courseId: course.id, channel, planKey: { not: null } },
    select: { id: true, planKey: true, status: true },
  });
  const byPlanKey = new Map(existing.map((rule) => [rule.planKey, rule]));

  let created = 0;
  let activated = 0;
  for (const entry of plan) {
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
          channel,
          subject: entry.subject,
          body: entry.body,
          status,
          requiresStreamUrl: entry.requiresStreamUrl,
          enrollmentStatuses: entry.enrollmentStatuses,
          waTemplateName: entry.waTemplateName,
          waTemplateLanguage: entry.waTemplateLanguage,
          waTemplateBodyVars: entry.waTemplateBodyVars ?? undefined,
          waTemplateUrlVar: entry.waTemplateUrlVar,
          nextExecutionAt,
          activatedAt: status === "ACTIVE" ? new Date() : null,
        },
      });
      created++;
      continue;
    }
    // El contenido editado por el administrador no se sobrescribe: solo se
    // reactiva la regla si asi se solicito.
    if (parsed.data.activate && current.status !== "ACTIVE") {
      await prisma.automationRule.update({ where: { id: current.id }, data: { status: "ACTIVE", nextExecutionAt, activatedAt: new Date() } });
      activated++;
    }
  }

  // Un curso con inscripciones previas debe recibir sus mensajes sin que nadie
  // tenga que abrir y volver a guardar la sesión a mano. La reprogramación es
  // idempotente y va por lotes, así que no duplica ni carga todo en memoria.
  const rescheduled = parsed.data.activate && (created > 0 || activated > 0)
    ? await rescheduleCourseAutomations(course.id)
    : null;

  await writeAudit({
    session: auth.session,
    action: "AUTOMATION_PLAN_APPLIED",
    entityType: "Course",
    entityId: course.id,
    metadata: {
      channel,
      created,
      activated,
      requested: plan.length,
      activate: parsed.data.activate,
      enrollmentsProcessed: rescheduled?.enrollments ?? 0,
      messagesCreated: rescheduled?.enqueued ?? 0,
      messagesUpdated: rescheduled?.updated ?? 0,
      messagesOmitted: rescheduled?.omitted ?? 0,
      truncated: rescheduled?.truncated ?? false,
    },
  });

  const channelLabel = channel === "WHATSAPP" ? "WhatsApp" : "correo";
  const planSummary = created === 0 && activated === 0
    ? `El curso ya tenía el plan de ${channelLabel} aplicado.`
    : `Plan de ${channelLabel} aplicado: ${created} reglas nuevas y ${activated} reactivadas.`;
  const enrollmentSummary = rescheduled
    ? ` Inscripciones existentes procesadas: ${rescheduled.enrollments}; mensajes creados: ${rescheduled.enqueued}, actualizados: ${rescheduled.updated}, omitidos: ${rescheduled.omitted}.`
    : parsed.data.activate
      ? ""
      : " El plan quedó en borrador: actívalo para que las inscripciones existentes reciban sus mensajes.";
  const truncatedWarning = rescheduled?.truncated
    ? " ATENCIÓN: quedaron inscripciones sin procesar por el límite de seguridad. Vuelve a aplicar el plan para continuar."
    : "";

  return NextResponse.json({
    ok: true,
    channel,
    created,
    activated,
    unchanged: plan.length - created - activated,
    enrollments: rescheduled
      ? {
          processed: rescheduled.enrollments,
          enqueued: rescheduled.enqueued,
          updated: rescheduled.updated,
          omitted: rescheduled.omitted,
          cancelled: rescheduled.cancelled,
          batches: rescheduled.batches,
          truncated: rescheduled.truncated,
        }
      : null,
    message: `${planSummary}${enrollmentSummary}${truncatedWarning}`,
  });
}
