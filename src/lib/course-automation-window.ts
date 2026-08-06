import { courseCompletionMoment, resolveCourseSessions, type CourseScheduleInput, type CourseSessionInput } from "@/lib/course-sessions";

/**
 * Ventana efectiva del curso para calcular la proxima ejecucion de una regla.
 *
 * Cuando hay sesiones registradas manda el calendario de sesiones; si no,
 * se usan `startsAt`/`endsAt` del curso como hasta ahora.
 */
export function courseAutomationWindow(course: CourseScheduleInput, sessions: readonly CourseSessionInput[] = []) {
  const resolved = resolveCourseSessions(course, sessions);
  return {
    startsAt: resolved[0]?.startAt ?? course.startsAt,
    endsAt: courseCompletionMoment(resolved) ?? course.endsAt,
    sessions: resolved.length,
  };
}
