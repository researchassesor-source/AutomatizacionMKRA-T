/**
 * Compara el calendario propuesto por WordPress contra las sesiones que ya
 * existen en el CRM, y calcula qué hacer para reconciliarlas.
 *
 * Todo aquí es puro: nada de Prisma ni fetch. La causa del incidente que
 * motivó este módulo fue justamente la ausencia de esta comparación —
 * "Sincronizar con la web" solo miraba cursos sin ninguna sesión— así que el
 * cálculo vive aparte para poder probarlo exhaustivamente sin una base de
 * datos real.
 *
 * El emparejamiento es por POSICIÓN cronológica: la sesión existente más
 * temprana con la propuesta más temprana, y así sucesivamente. Preservar el
 * id de cada sesión emparejada es lo que permite que los mensajes ya
 * programados (identificados por courseSessionId) se reprogramen en lugar de
 * recrearse con una identidad nueva.
 */

export type ExistingSession = { id: string; startAt: Date; endAt: Date | null };
export type ProposedSession = { startAt: string; endAt: string | null };

export type ScheduleComparisonStatus = "SIN_CALENDARIO_CRM" | "CALENDARIO_IGUAL" | "CALENDARIO_CAMBIADO";

function sortByStart<T extends { startAt: Date }>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

function toDates(sessions: readonly ProposedSession[]): Array<{ startAt: Date; endAt: Date | null }> {
  return sessions.map((session) => ({
    startAt: new Date(session.startAt),
    endAt: session.endAt ? new Date(session.endAt) : null,
  }));
}

function sameInstant(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

function sameSession(existing: { startAt: Date; endAt: Date | null }, proposed: { startAt: Date; endAt: Date | null }): boolean {
  const startEqual = sameInstant(existing.startAt, proposed.startAt);
  const endEqual = existing.endAt === null && proposed.endAt === null
    ? true
    : existing.endAt !== null && proposed.endAt !== null
      ? sameInstant(existing.endAt, proposed.endAt)
      : false;
  return startEqual && endEqual;
}

/**
 * Clasifica la relación entre el calendario del CRM y el propuesto.
 *
 * La comparación es por instante absoluto (los `Date` ya representan UTC, y
 * `isoDesdeLocal` en course-schedule-parser ya aplicó la zona horaria de
 * Ecuador al construir la propuesta), nunca por texto: dos formas distintas
 * de escribir la misma hora nunca deben leerse como un cambio.
 */
export function compareCourseSchedule(
  existing: readonly ExistingSession[],
  proposed: readonly ProposedSession[],
): ScheduleComparisonStatus {
  if (existing.length === 0) return "SIN_CALENDARIO_CRM";
  const existingSorted = sortByStart(existing);
  const proposedSorted = sortByStart(toDates(proposed));
  if (existingSorted.length !== proposedSorted.length) return "CALENDARIO_CAMBIADO";
  const igual = existingSorted.every((session, index) => sameSession(session, proposedSorted[index]));
  return igual ? "CALENDARIO_IGUAL" : "CALENDARIO_CAMBIADO";
}

export type ReconciliationPlan = {
  /** Sesiones existentes cuya fecha cambió: se actualizan preservando su id. */
  toUpdate: Array<{ id: string; startAt: Date; endAt: Date | null }>;
  /** Sesiones existentes que sobran porque el calendario nuevo tiene menos fechas. */
  toRemove: Array<{ id: string }>;
  /** Fechas propuestas sin sesión existente que emparejar: se crean. */
  toCreate: Array<{ startAt: Date; endAt: Date | null }>;
};

/**
 * Calcula qué cambiar, sin tocar la base de datos.
 *
 * Las posiciones emparejadas cuya fecha ya coincide NO entran en `toUpdate`:
 * escribir sin necesidad movería `updatedAt` de una sesión que nadie cambió.
 */
export function planScheduleReconciliation(
  existing: readonly ExistingSession[],
  proposed: readonly ProposedSession[],
): ReconciliationPlan {
  const existingSorted = sortByStart(existing);
  const proposedSorted = sortByStart(toDates(proposed));
  const matched = Math.min(existingSorted.length, proposedSorted.length);

  const toUpdate = existingSorted.slice(0, matched).flatMap((session, index) => {
    const candidate = proposedSorted[index];
    if (sameSession(session, candidate)) return [];
    return [{ id: session.id, startAt: candidate.startAt, endAt: candidate.endAt }];
  });
  const toRemove = existingSorted.slice(matched).map((session) => ({ id: session.id }));
  const toCreate = proposedSorted.slice(matched).map((session) => ({ startAt: session.startAt, endAt: session.endAt }));

  return { toUpdate, toRemove, toCreate };
}
