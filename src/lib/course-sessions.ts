import { ECUADOR_TIME_ZONE } from "@/lib/automation-schedule";

/**
 * Capa de compatibilidad entre cursos con una sola fecha y cursos con varias
 * sesiones.
 *
 * Los cursos historicos solo tienen `startsAt`/`endsAt`. En lugar de duplicar
 * datos con una migracion de contenido, se tratan como una sesion unica
 * "virtual". Los recordatorios se calculan siempre sobre esta lista, asi que el
 * motor no necesita dos caminos distintos.
 */
export type ResolvedCourseSession = {
  /** Id real de `course_sessions`, o null cuando la sesion es virtual. */
  id: string | null;
  /** Clave estable usada en la idempotencia de los mensajes. */
  key: string;
  title: string | null;
  startAt: Date;
  endAt: Date | null;
  /** Enlace propio de la sesion o, en su defecto, el del curso. */
  streamUrl: string | null;
  timezone: string;
  /** true cuando proviene de `startsAt`/`endsAt` del curso. */
  isVirtual: boolean;
  /** Posicion 1..n dentro del curso, ordenada por fecha de inicio. */
  position: number;
  totalSessions: number;
};

export type CourseScheduleInput = {
  startsAt: Date | null;
  endsAt: Date | null;
  streamUrl?: string | null;
};

export type CourseSessionInput = {
  id: string;
  title: string | null;
  startAt: Date;
  endAt: Date | null;
  streamUrl: string | null;
  timezone?: string | null;
};

/**
 * Devuelve las sesiones de un curso ordenadas por fecha de inicio.
 *
 * Sin sesiones registradas se produce una sesion virtual con la fecha del
 * curso. Si el curso tampoco tiene fecha, la lista queda vacia y los
 * recordatorios simplemente no se programan.
 */
export function resolveCourseSessions(
  course: CourseScheduleInput,
  sessions: readonly CourseSessionInput[] = [],
): ResolvedCourseSession[] {
  const real = [...sessions].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (real.length > 0) {
    return real.map((session, index) => ({
      id: session.id,
      key: session.id,
      title: session.title,
      startAt: session.startAt,
      endAt: session.endAt,
      streamUrl: session.streamUrl?.trim() || course.streamUrl?.trim() || null,
      timezone: session.timezone?.trim() || ECUADOR_TIME_ZONE,
      isVirtual: false,
      position: index + 1,
      totalSessions: real.length,
    }));
  }
  if (!course.startsAt) return [];
  return [
    {
      id: null,
      // La clave vacia conserva exactamente las claves idempotentes que ya
      // existen en produccion para los cursos de una sola fecha.
      key: "",
      title: null,
      startAt: course.startsAt,
      endAt: course.endsAt,
      streamUrl: course.streamUrl?.trim() || null,
      timezone: ECUADOR_TIME_ZONE,
      isVirtual: true,
      position: 1,
      totalSessions: 1,
    },
  ];
}

/** Sesiones cuyo inicio todavia no ha ocurrido. */
export function upcomingSessions(sessions: readonly ResolvedCourseSession[], now = new Date()) {
  return sessions.filter((session) => session.startAt.getTime() > now.getTime());
}

/** Ultima sesion del curso; base del correo de agradecimiento. */
export function lastSession(sessions: readonly ResolvedCourseSession[]): ResolvedCourseSession | null {
  return sessions.length ? sessions[sessions.length - 1] : null;
}

/** Momento en que el curso termina realmente (fin de la ultima sesion). */
export function courseCompletionMoment(sessions: readonly ResolvedCourseSession[]): Date | null {
  const last = lastSession(sessions);
  if (!last) return null;
  return last.endAt ?? last.startAt;
}

export function sessionLabel(session: ResolvedCourseSession): string {
  if (session.title?.trim()) return session.title.trim();
  if (session.totalSessions <= 1) return "Sesión única";
  return `Sesión ${session.position} de ${session.totalSessions}`;
}
