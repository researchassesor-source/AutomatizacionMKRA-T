import type { AutomationTrigger, MessageChannel } from "@prisma/client";

export type AutomationCourseState = {
  isPublished: boolean;
  acceptsRegistrations: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type AutomationRuleState = {
  trigger: AutomationTrigger;
  channel: MessageChannel;
  subject: string | null;
  body: string;
};

/**
 * ¿El curso admite inscripciones nuevas desde el formulario público?
 *
 * Es una decisión comercial: cerrar el cupo. Solo gobierna la puerta de
 * entrada.
 */
export function courseAcceptsNewRegistrations(
  course: Pick<AutomationCourseState, "isPublished" | "acceptsRegistrations">,
) {
  return course.isPublished && course.acceptsRegistrations;
}

/**
 * ¿El curso puede ejecutar automatizaciones de sus inscripciones ya existentes?
 *
 * Deliberadamente NO mira `acceptsRegistrations`. Cerrar el cupo es lo normal
 * cuando el curso está por empezar: si eso apagara los recordatorios, quienes
 * ya pagaron y reservaron su lugar dejarían de recibir la bienvenida y el
 * enlace de acceso justo cuando más lo necesitan.
 *
 * Lo que sí importa es que el curso siga publicado: despublicarlo es la señal
 * de que la actividad no va, y ahí sí debe callarse.
 */
export function courseAcceptsAutomations(course: Pick<AutomationCourseState, "isPublished">) {
  return course.isPublished;
}

export function automationRuleCanRun(course: AutomationCourseState, rule: AutomationRuleState) {
  if (!courseAcceptsAutomations(course) || !rule.body.trim()) return false;
  if (rule.channel === "EMAIL" && !rule.subject?.trim()) return false;
  if (rule.trigger === "BEFORE_COURSE" && !course.startsAt) return false;
  if (rule.trigger === "AFTER_COURSE" && !(course.endsAt ?? course.startsAt)) return false;
  return true;
}
