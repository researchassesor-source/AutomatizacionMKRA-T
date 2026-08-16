import { DEFAULT_AUTOMATION_PLAN } from "@/lib/nurture/default-automations";
import { courseCompletionMoment, type ResolvedCourseSession } from "@/lib/course-sessions";

/**
 * Cuando se envia automaticamente la oferta institucional.
 *
 * Se calcula desde el final REAL del plan de once mensajes, no desde una
 * constante. El ultimo de los once es la encuesta, a 48 horas del fin de la
 * ultima sesion; escribir "+72 h" a mano habria funcionado hoy y habria dejado
 * de funcionar el dia que alguien cambie ese desfase, sin que nada avisara.
 *
 * La espera posterior sale de `institutionalOfferDelayHours` del curso, con 24
 * horas por defecto. Se separa del calculo del fin del plan a proposito: son
 * dos decisiones distintas y una es configurable.
 */

/** Minutos entre el fin del curso y el ultimo de los once mensajes. */
export function minutosHastaUltimoMensaje(): number {
  const posteriores = DEFAULT_AUTOMATION_PLAN.filter((entrada) => entrada.trigger === "AFTER_COURSE");
  return posteriores.reduce((maximo, entrada) => Math.max(maximo, Math.abs(entrada.offsetMinutes)), 0);
}

/**
 * Momento del envio automatico, o `null` si el curso todavia no tiene sesiones
 * con las que calcularlo. Sin fecha de fin no hay nada que programar, y
 * inventar una haria salir la oferta antes de que el curso termine.
 */
export function calcularEnvioAutomatico(
  sesiones: readonly ResolvedCourseSession[],
  delayHoras: number,
): Date | null {
  const finDelCurso = courseCompletionMoment(sesiones);
  if (!finDelCurso) return null;
  const horas = Number.isFinite(delayHoras) && delayHoras >= 0 ? delayHoras : 24;
  const minutos = minutosHastaUltimoMensaje() + horas * 60;
  return new Date(finDelCurso.getTime() + minutos * 60_000);
}
