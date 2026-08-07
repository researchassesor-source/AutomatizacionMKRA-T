import type { AutomationRule } from "@prisma/client";
import { calculateAutomationSchedule } from "@/lib/automation-schedule";
import { courseCompletionMoment, upcomingSessions, type ResolvedCourseSession } from "@/lib/course-sessions";

/**
 * Construye la linea de tiempo de comunicaciones de un curso.
 *
 * Traduce el modelo interno (disparador + desplazamiento en minutos + reglas
 * por canal) a los cinco momentos que el negocio reconoce, con la fecha real
 * calculada y el motivo concreto por el que un paso no puede salir.
 *
 * El orden es el del recorrido de la persona inscrita, no el del sistema.
 */
export const TIMELINE_STEPS = [
  { planKey: "welcome", when: "Al inscribirse", title: "Confirmación de inscripción", detail: "Sale en el momento del registro." },
  { planKey: "reminder_24h", when: "1 día antes", title: "Recordatorio", detail: "Avisa de la sesión del día siguiente." },
  { planKey: "reminder_2h", when: "2 horas antes", title: "Enlace de acceso", detail: "Entrega el enlace de la reunión." },
  { planKey: "reminder_15m", when: "15 minutos antes", title: "Ya empezamos", detail: "Repite el enlace justo antes de comenzar." },
  { planKey: "thank_you", when: "Al terminar", title: "Felicitación", detail: "Cierra el curso agradeciendo la participación." },
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

/**
 * Motivo por el que un paso no puede salir, en el orden en que le conviene
 * saberlo a quien lo va a arreglar: primero lo que depende de esta pantalla.
 */
function blockedReason(
  rules: TimelineRule[],
  reference: ResolvedCourseSession | null,
  hasSchedule: boolean,
  planKey: string,
): string | null {
  if (rules.length === 0) return "Este aviso no está configurado para el curso.";
  if (planKey !== "welcome" && !hasSchedule) return "El curso no tiene fecha, así que no se puede calcular cuándo enviarlo.";
  const necesitaEnlace = rules.some((rule) => rule.requiresStreamUrl);
  if (necesitaEnlace && !reference?.streamUrl) return "Falta el enlace de la reunión de esta sesión.";
  const whatsappSinPlantilla = rules.some((rule) => rule.channel === "WHATSAPP" && !rule.waTemplateName?.trim());
  if (whatsappSinPlantilla) return "La versión de WhatsApp no tiene plantilla aprobada asignada.";
  return null;
}

export function buildCourseTimeline(input: {
  rules: TimelineRule[];
  sessions: readonly ResolvedCourseSession[];
  now?: Date;
}): BuiltStep[] {
  const now = input.now ?? new Date();
  const proxima = upcomingSessions(input.sessions, now)[0] ?? input.sessions[0] ?? null;
  const hasSchedule = input.sessions.length > 0 && Boolean(proxima?.startAt);
  const fin = courseCompletionMoment(input.sessions);

  return TIMELINE_STEPS.map((step) => {
    // Solo cuentan las reglas vivas: una archivada no representa nada.
    const rules = input.rules.filter((rule) => rule.planKey === step.planKey && rule.status !== "ARCHIVED");
    const canales = [...new Set(rules.filter((rule) => rule.status === "ACTIVE").map((rule) => rule.channel))] as Array<"EMAIL" | "WHATSAPP">;
    const active = canales.length > 0;

    let scheduledAt: Date | null = null;
    const cualquiera = rules[0];
    if (cualquiera && hasSchedule && proxima) {
      if (cualquiera.trigger === "BEFORE_COURSE") {
        scheduledAt = calculateAutomationSchedule({
          trigger: "BEFORE_COURSE",
          offsetMinutes: cualquiera.offsetMinutes,
          registeredAt: now,
          startsAt: proxima.startAt,
        });
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
      blockedReason: blockedReason(rules, proxima, hasSchedule, step.planKey),
      ruleNames: rules.map((rule) => `${rule.channel === "EMAIL" ? "correo" : "whatsapp"}:${rule.status.toLowerCase()}`),
    };
  });
}
