import { describe, expect, it } from "vitest";
import { calculateAutomationSchedule, nextFixedRuleExecution, supportsEnrollmentStatus } from "./automation-schedule";

describe("programación relativa de automatizaciones", () => {
  const registeredAt = new Date("2026-08-03T14:00:00.000Z");
  const startsAt = new Date("2026-08-10T14:00:00.000Z");
  const endsAt = new Date("2026-08-10T16:00:00.000Z");

  it("programa confirmación inmediata al registro", () => {
    expect(calculateAutomationSchedule({ trigger: "ON_REGISTRATION", offsetMinutes: 0, registeredAt, startsAt, endsAt })?.toISOString()).toBe(registeredAt.toISOString());
  });

  it("programa 24 horas y 2 horas antes del curso", () => {
    expect(calculateAutomationSchedule({ trigger: "BEFORE_COURSE", offsetMinutes: 1440, registeredAt, startsAt, endsAt })?.toISOString()).toBe("2026-08-09T14:00:00.000Z");
    expect(calculateAutomationSchedule({ trigger: "BEFORE_COURSE", offsetMinutes: 120, registeredAt, startsAt, endsAt })?.toISOString()).toBe("2026-08-10T12:00:00.000Z");
  });

  it("programa agradecimiento después de la hora final", () => {
    expect(calculateAutomationSchedule({ trigger: "AFTER_COURSE", offsetMinutes: 60, registeredAt, startsAt, endsAt })?.toISOString()).toBe("2026-08-10T17:00:00.000Z");
  });

  it("no inventa una fecha cuando el curso no tiene agenda", () => {
    expect(calculateAutomationSchedule({ trigger: "BEFORE_COURSE", offsetMinutes: 120, registeredAt, startsAt: null })).toBeNull();
    expect(nextFixedRuleExecution({ trigger: "AFTER_COURSE", offsetMinutes: 60, startsAt: null, endsAt: null }, registeredAt)).toBeNull();
  });

  it("segmenta por estado de inscripción", () => {
    expect(supportsEnrollmentStatus(["INTERESADO", "INSCRITO"], "INTERESADO")).toBe(true);
    expect(supportsEnrollmentStatus(["INSCRITO"], "CANCELADO")).toBe(false);
  });
});
