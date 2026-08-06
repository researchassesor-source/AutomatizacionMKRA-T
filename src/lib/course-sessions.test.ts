import { describe, expect, it } from "vitest";
import {
  courseCompletionMoment,
  lastSession,
  resolveCourseSessions,
  sessionLabel,
  upcomingSessions,
} from "./course-sessions";

const course = {
  startsAt: new Date("2026-08-20T14:00:00.000Z"),
  endsAt: new Date("2026-08-20T17:00:00.000Z"),
  streamUrl: "https://meet.example.com/ra-training",
};

describe("compatibilidad entre cursos con una fecha y cursos con sesiones", () => {
  it("convierte la fecha del curso en una sesión virtual", () => {
    const [session] = resolveCourseSessions(course);
    expect(session.isVirtual).toBe(true);
    expect(session.startAt).toEqual(course.startsAt);
    expect(session.streamUrl).toBe(course.streamUrl);
  });

  it("mantiene la clave idempotente vacía en la sesión virtual", () => {
    // Es lo que garantiza que los cursos ya existentes en producción no
    // reciban un segundo recordatorio con una clave nueva.
    expect(resolveCourseSessions(course)[0].key).toBe("");
  });

  it("no produce sesiones cuando el curso no tiene fecha", () => {
    expect(resolveCourseSessions({ startsAt: null, endsAt: null })).toEqual([]);
  });

  it("ordena las sesiones reales por fecha de inicio", () => {
    const sessions = resolveCourseSessions(course, [
      { id: "s2", title: "Segunda", startAt: new Date("2026-08-22T14:00:00.000Z"), endAt: null, streamUrl: null },
      { id: "s1", title: "Primera", startAt: new Date("2026-08-21T14:00:00.000Z"), endAt: null, streamUrl: null },
    ]);
    expect(sessions.map((session) => session.id)).toEqual(["s1", "s2"]);
    expect(sessions.map((session) => session.position)).toEqual([1, 2]);
    expect(sessions.every((session) => session.totalSessions === 2)).toBe(true);
  });

  it("hereda el enlace del curso cuando la sesión no tiene uno propio", () => {
    const [heredada, propia] = resolveCourseSessions(course, [
      { id: "s1", title: null, startAt: new Date("2026-08-21T14:00:00.000Z"), endAt: null, streamUrl: null },
      { id: "s2", title: null, startAt: new Date("2026-08-22T14:00:00.000Z"), endAt: null, streamUrl: "https://zoom.example.com/otra" },
    ]);
    expect(heredada.streamUrl).toBe(course.streamUrl);
    expect(propia.streamUrl).toBe("https://zoom.example.com/otra");
  });

  it("las sesiones reales desplazan a la fecha general del curso", () => {
    const sessions = resolveCourseSessions(course, [
      { id: "s1", title: null, startAt: new Date("2026-09-01T14:00:00.000Z"), endAt: null, streamUrl: null },
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].isVirtual).toBe(false);
  });

  it("el agradecimiento se basa en el cierre de la última sesión", () => {
    const sessions = resolveCourseSessions(course, [
      { id: "s1", title: null, startAt: new Date("2026-08-21T14:00:00.000Z"), endAt: new Date("2026-08-21T16:00:00.000Z"), streamUrl: null },
      { id: "s2", title: null, startAt: new Date("2026-08-22T14:00:00.000Z"), endAt: new Date("2026-08-22T16:00:00.000Z"), streamUrl: null },
    ]);
    expect(lastSession(sessions)?.id).toBe("s2");
    expect(courseCompletionMoment(sessions)?.toISOString()).toBe("2026-08-22T16:00:00.000Z");
  });

  it("usa el inicio cuando la última sesión no tiene cierre", () => {
    const sessions = resolveCourseSessions({ startsAt: new Date("2026-08-21T14:00:00.000Z"), endsAt: null });
    expect(courseCompletionMoment(sessions)?.toISOString()).toBe("2026-08-21T14:00:00.000Z");
  });

  it("filtra las sesiones que ya ocurrieron", () => {
    const sessions = resolveCourseSessions(course, [
      { id: "s1", title: null, startAt: new Date("2026-08-01T14:00:00.000Z"), endAt: null, streamUrl: null },
      { id: "s2", title: null, startAt: new Date("2026-09-01T14:00:00.000Z"), endAt: null, streamUrl: null },
    ]);
    expect(upcomingSessions(sessions, new Date("2026-08-15T00:00:00.000Z")).map((s) => s.id)).toEqual(["s2"]);
  });

  it("describe la sesión para el texto del correo", () => {
    const [unica] = resolveCourseSessions(course);
    expect(sessionLabel(unica)).toBe("Sesión única");
    const sessions = resolveCourseSessions(course, [
      { id: "s1", title: "Introducción", startAt: new Date("2026-08-21T14:00:00.000Z"), endAt: null, streamUrl: null },
      { id: "s2", title: null, startAt: new Date("2026-08-22T14:00:00.000Z"), endAt: null, streamUrl: null },
    ]);
    expect(sessionLabel(sessions[0])).toBe("Introducción");
    expect(sessionLabel(sessions[1])).toBe("Sesión 2 de 2");
  });
});
