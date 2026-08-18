import type { AutomationRule } from "@prisma/client";
import { calculateAutomationSchedule } from "@/lib/automation-schedule";
import { courseCompletionMoment, upcomingSessions, type ResolvedCourseSession } from "@/lib/course-sessions";

export const TIMELINE_STEPS = [
  { planKey: "welcome", when: "Al inscribirse", title: "Confirmacion de inscripcion", detail: "Sale en el momento del registro." },
  { planKey: "whatsapp_group", when: "2 minutos despues", title: "Grupo WhatsApp", detail: "Entrega el grupo oficial configurado para el curso." },
  { planKey: "reminder_24h", when: "1 dia antes", title: "Recordatorio", detail: "Avisa de la sesion del dia siguiente." },
  { planKey: "reminder_2h", when: "2 horas antes", title: "Enlace de acceso", detail: "Entrega el enlace de la reunion." },
  { planKey: "reminder_15m", when: "15 minutos antes", title: "Ya empezamos", detail: "Repite el enlace justo antes de comenzar." },
  { planKey: "session_live", when: "Al iniciar", title: "Sesion en vivo", detail: "Aviso de inicio con enlace directo." },
  { planKey: "late_access", when: "20 minutos despues", title: "Acceso rezagados", detail: "Reenvia el enlace a quien entra tarde." },
  { planKey: "session_complete", when: "5 minutos despues de terminar", title: "Fin de sesion", detail: "Cierra el curso agradeciendo la participacion." },
  { planKey: "course_complete", when: "1 hora despues", title: "Curso completo", detail: "Comparte la informacion completa del curso." },
  { planKey: "course_follow_up", when: "24 horas despues", title: "Seguimiento", detail: "Abre una via de apoyo posterior." },
  { planKey: "survey", when: "48 horas despues", title: "Encuesta final", detail: "Solicita la encuesta configurada en el curso." },
] as const;

export type TimelineRule = Pick<
  AutomationRule,
  "id" | "name" | "planKey" | "channel" | "status" | "trigger" | "offsetMinutes" | "requiresStreamUrl" | "waTemplateName"
>;

export type BuiltStep = {
  planKey: string;
  when: string;
  title: string;
  detail: string;
  channels: Array<"EMAIL" | "WHATSAPP">;
  scheduledAt: Date | null;
  active: boolean;
  blockedReason: string | null;
  ruleNames: string[];
};

function blockedReason(
  rules: TimelineRule[],
  reference: ResolvedCourseSession | null,
  hasSchedule: boolean,
  planKey: string,
  config?: { whatsappGroupUrl?: string | null; courseCompleteUrl?: string | null; surveyUrl?: string | null },
): string | null {
  if (rules.length === 0) return "Este aviso no esta configurado para el curso.";
  if (planKey !== "welcome" && planKey !== "whatsapp_group" && !hasSchedule) return "El curso no tiene fecha, asi que no se puede calcular cuando enviarlo.";
  const necesitaEnlace = rules.some((rule) => rule.requiresStreamUrl);
  if (necesitaEnlace && !reference?.streamUrl) return "Falta el enlace de la reunion de esta sesion.";
  if (config && planKey === "whatsapp_group" && !config.whatsappGroupUrl?.trim()) return "Falta el enlace del grupo de WhatsApp en Configuracion.";
  if (config && planKey === "course_complete" && !config.courseCompleteUrl?.trim()) return "Falta la pagina informativa del curso completo en Configuracion.";
  if (config && planKey === "survey" && !config.surveyUrl?.trim()) return "Falta la encuesta final en Configuracion.";
  const whatsappSinPlantilla = rules.some((rule) => rule.channel === "WHATSAPP" && !rule.waTemplateName?.trim());
  if (whatsappSinPlantilla) return "La version de WhatsApp no tiene plantilla aprobada asignada.";
  return null;
}

export function buildCourseTimeline(input: {
  rules: TimelineRule[];
  sessions: readonly ResolvedCourseSession[];
  config?: { whatsappGroupUrl?: string | null; courseCompleteUrl?: string | null; surveyUrl?: string | null };
  now?: Date;
}): BuiltStep[] {
  const now = input.now ?? new Date();
  const proxima = upcomingSessions(input.sessions, now)[0] ?? input.sessions[0] ?? null;
  const hasSchedule = input.sessions.length > 0 && Boolean(proxima?.startAt);
  const fin = courseCompletionMoment(input.sessions);

  return TIMELINE_STEPS.map((step) => {
    const rules = input.rules.filter((rule) => rule.planKey === step.planKey && rule.status !== "ARCHIVED");
    const canales = [...new Set(rules.filter((rule) => rule.status === "ACTIVE").map((rule) => rule.channel))] as Array<"EMAIL" | "WHATSAPP">;
    const active = canales.length > 0;

    let scheduledAt: Date | null = null;
    const cualquiera = rules[0];
    if (cualquiera) {
      if (cualquiera.trigger === "ON_REGISTRATION") {
        scheduledAt = null;
      } else if (hasSchedule && proxima && cualquiera.trigger === "BEFORE_COURSE") {
        scheduledAt = calculateAutomationSchedule({
          trigger: "BEFORE_COURSE",
          offsetMinutes: cualquiera.offsetMinutes,
          registeredAt: now,
          startsAt: proxima.startAt,
        });
      } else if (hasSchedule && proxima && cualquiera.trigger === "AFTER_COURSE" && cualquiera.planKey === "late_access") {
        scheduledAt = new Date(proxima.startAt.getTime() + Math.abs(cualquiera.offsetMinutes) * 60_000);
      } else if (cualquiera.trigger === "AFTER_COURSE" && fin) {
        scheduledAt = new Date(fin.getTime() + Math.abs(cualquiera.offsetMinutes) * 60_000);
      }
    }

    return {
      planKey: step.planKey,
      when: step.when,
      title: step.title,
      detail: step.detail,
      channels: canales,
      scheduledAt,
      active,
      blockedReason: blockedReason(rules, proxima, hasSchedule, step.planKey, input.config),
      ruleNames: rules.map((rule) => `${rule.channel === "EMAIL" ? "correo" : "whatsapp"}:${rule.status.toLowerCase()}`),
    };
  });
}
