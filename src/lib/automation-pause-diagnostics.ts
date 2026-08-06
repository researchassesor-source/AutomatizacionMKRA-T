import { automationRuleCanRun } from "@/lib/automation-eligibility";
import { writeAudit } from "@/lib/audit";
import { courseAutomationWindow } from "@/lib/course-automation-window";
import { prisma } from "@/lib/db";
import type { AdminSession } from "@/lib/auth/session";

/**
 * Diagnóstico de automatizaciones pausadas.
 *
 * Contexto: la sincronización de WordPress pausaba toda regla cuyo curso no
 * cumpliera `isPublished && acceptsRegistrations`. Como la sincronización crea
 * los cursos con `acceptsRegistrations: false` y nunca los reabre, cualquier
 * curso importado perdía sus automatizaciones en la siguiente pasada aunque
 * estuviera publicado y vigente.
 *
 * Este módulo NO reactiva nada por su cuenta. Primero permite ver, curso por
 * curso, qué se pausó y por qué; la recuperación es una acción explícita,
 * idempotente y auditada.
 */
export type PauseReason =
  | "COURSE_HISTORICAL"
  | "COURSE_UNPUBLISHED"
  | "COURSE_WITHOUT_SCHEDULE"
  | "RULE_TEMPLATE_INVALID"
  | "RECOVERABLE";

export const PAUSE_REASON_LABELS: Record<PauseReason, string> = {
  COURSE_HISTORICAL: "El curso ya no aparece en el catálogo de WordPress.",
  COURSE_UNPUBLISHED: "El curso está despublicado.",
  COURSE_WITHOUT_SCHEDULE: "El curso no tiene fecha ni sesiones que permitan calcular el envío.",
  RULE_TEMPLATE_INVALID: "La regla no tiene asunto o cuerpo válidos.",
  RECOVERABLE: "El curso está vigente y la regla puede volver a activarse: se pausó por error.",
};

export type PausedRuleDiagnosis = {
  ruleId: string;
  ruleName: string;
  channel: string;
  trigger: string;
  offsetMinutes: number;
  planKey: string | null;
  updatedAt: string;
  reason: PauseReason;
  recoverable: boolean;
};

export type PausedCourseDiagnosis = {
  courseId: string;
  title: string;
  slug: string;
  externalId: string | null;
  externalSource: string | null;
  isPublished: boolean;
  acceptsRegistrations: boolean;
  syncStatus: string;
  sessions: number;
  hasSchedule: boolean;
  enrollments: number;
  rules: PausedRuleDiagnosis[];
  recoverableRules: number;
};

export type PauseDiagnosisReport = {
  generatedAt: string;
  pausedRules: number;
  recoverableRules: number;
  courses: PausedCourseDiagnosis[];
  /** Última pausa registrada por la sincronización, si existe. */
  lastSyncPauseAt: string | null;
};

const pausedRuleSelect = {
  id: true,
  name: true,
  channel: true,
  trigger: true,
  offsetMinutes: true,
  subject: true,
  body: true,
  planKey: true,
  updatedAt: true,
} as const;

/** Solo lectura: no modifica ninguna regla ni ningún mensaje. */
export async function diagnosePausedAutomations(): Promise<PauseDiagnosisReport> {
  const courses = await prisma.course.findMany({
    where: { automationRules: { some: { status: "PAUSED" } } },
    select: {
      id: true,
      title: true,
      slug: true,
      externalId: true,
      externalSource: true,
      isPublished: true,
      acceptsRegistrations: true,
      syncStatus: true,
      startsAt: true,
      endsAt: true,
      streamUrl: true,
      sessions: { select: { id: true, title: true, startAt: true, endAt: true, streamUrl: true }, orderBy: { startAt: "asc" } },
      automationRules: { where: { status: "PAUSED" }, select: pausedRuleSelect, orderBy: { offsetMinutes: "desc" } },
      _count: { select: { enrollments: true } },
    },
    orderBy: [{ isPublished: "desc" }, { title: "asc" }],
  });

  const lastPause = await prisma.auditLog.findFirst({
    where: { action: "AUTOMATION_RULES_PAUSED_BY_SYNC" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const report: PausedCourseDiagnosis[] = courses.map((course) => {
    const window = courseAutomationWindow(course, course.sessions);
    const courseState = {
      isPublished: course.isPublished,
      acceptsRegistrations: course.acceptsRegistrations,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    };
    const rules = course.automationRules.map((rule) => {
      const canRun = automationRuleCanRun(courseState, rule);
      const reason: PauseReason = canRun
        ? "RECOVERABLE"
        : course.syncStatus === "HISTORICAL"
          ? "COURSE_HISTORICAL"
          : !course.isPublished
            ? "COURSE_UNPUBLISHED"
            : !rule.subject?.trim() || !rule.body.trim()
              ? "RULE_TEMPLATE_INVALID"
              : "COURSE_WITHOUT_SCHEDULE";
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        channel: rule.channel,
        trigger: rule.trigger,
        offsetMinutes: rule.offsetMinutes,
        planKey: rule.planKey,
        updatedAt: rule.updatedAt.toISOString(),
        reason,
        recoverable: canRun,
      };
    });
    return {
      courseId: course.id,
      title: course.title,
      slug: course.slug,
      externalId: course.externalId,
      externalSource: course.externalSource,
      isPublished: course.isPublished,
      acceptsRegistrations: course.acceptsRegistrations,
      syncStatus: course.syncStatus,
      sessions: course.sessions.length,
      hasSchedule: Boolean(window.startsAt),
      enrollments: course._count.enrollments,
      rules,
      recoverableRules: rules.filter((rule) => rule.recoverable).length,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    pausedRules: report.reduce((total, course) => total + course.rules.length, 0),
    recoverableRules: report.reduce((total, course) => total + course.recoverableRules, 0),
    courses: report,
    lastSyncPauseAt: lastPause?.createdAt.toISOString() ?? null,
  };
}

export type RecoveryResult = {
  reactivated: number;
  courses: number;
  skipped: number;
  details: Array<{ courseId: string; courseTitle: string; ruleIds: string[] }>;
};

/**
 * Reactiva únicamente las reglas que hoy vuelven a ser ejecutables.
 *
 * Nunca reactiva de forma masiva a ciegas: una regla solo se toca si el curso
 * está publicado y con calendario válido, es decir, si su pausa fue un error.
 * Conserva textos, canal, segmentación y `planKey`; solo cambia el estado.
 *
 * Es idempotente: una segunda ejecución no encuentra nada que reactivar.
 * No programa mensajes por su cuenta; eso queda para la reprogramación del
 * curso, que sí es idempotente y no duplica.
 */
export async function recoverPausedAutomations(
  session: AdminSession | null,
  options: { courseId?: string } = {},
): Promise<RecoveryResult> {
  const diagnosis = await diagnosePausedAutomations();
  const targets = diagnosis.courses
    .filter((course) => !options.courseId || course.courseId === options.courseId)
    .map((course) => ({
      courseId: course.courseId,
      courseTitle: course.title,
      ruleIds: course.rules.filter((rule) => rule.recoverable).map((rule) => rule.ruleId),
    }))
    .filter((course) => course.ruleIds.length > 0);

  const ruleIds = targets.flatMap((course) => course.ruleIds);
  if (ruleIds.length === 0) {
    return { reactivated: 0, courses: 0, skipped: diagnosis.pausedRules, details: [] };
  }

  // El filtro por estado hace la operación segura ante ejecuciones simultáneas:
  // una regla que ya dejó de estar en PAUSED no se toca.
  const updated = await prisma.automationRule.updateMany({
    where: { id: { in: ruleIds }, status: "PAUSED" },
    data: { status: "ACTIVE" },
  });

  await writeAudit({
    session,
    actorEmail: session ? undefined : "automation-recovery",
    action: "AUTOMATION_RULES_RECOVERED",
    entityType: "AutomationRule",
    metadata: {
      reactivated: updated.count,
      courses: targets.length,
      cause: "Pausadas por la sincronización con la condición acceptsRegistrations, ya corregida.",
      details: targets,
    },
  });

  return {
    reactivated: updated.count,
    courses: targets.length,
    skipped: diagnosis.pausedRules - ruleIds.length,
    details: targets,
  };
}
