import { describe, expect, it } from "vitest";
import { automationRuleCanRun, courseAcceptsAutomations } from "./automation-eligibility";

const course = {
  isPublished: true,
  acceptsRegistrations: true,
  startsAt: new Date("2026-08-11T00:30:00.000Z"),
  endsAt: new Date("2026-08-14T02:00:00.000Z"),
};

describe("elegibilidad de automatizaciones por curso", () => {
  it("exige curso vigente, publicado y con registro abierto", () => {
    expect(courseAcceptsAutomations(course)).toBe(true);
    expect(courseAcceptsAutomations({ ...course, isPublished: false })).toBe(false);
    expect(courseAcceptsAutomations({ ...course, acceptsRegistrations: false })).toBe(false);
  });

  it("exige fecha para reglas dependientes del curso", () => {
    const email = { channel: "EMAIL" as const, subject: "Recordatorio", body: "Contenido" };
    expect(automationRuleCanRun({ ...course, startsAt: null }, { ...email, trigger: "BEFORE_COURSE" })).toBe(false);
    expect(automationRuleCanRun({ ...course, startsAt: null, endsAt: null }, { ...email, trigger: "AFTER_COURSE" })).toBe(false);
    expect(automationRuleCanRun(course, { ...email, trigger: "AFTER_COURSE" })).toBe(true);
  });

  it("rechaza plantillas vacías y exige asunto en correo", () => {
    expect(automationRuleCanRun(course, { trigger: "ON_REGISTRATION", channel: "WHATSAPP", subject: null, body: " " })).toBe(false);
    expect(automationRuleCanRun(course, { trigger: "ON_REGISTRATION", channel: "EMAIL", subject: null, body: "Contenido" })).toBe(false);
    expect(automationRuleCanRun(course, { trigger: "ON_REGISTRATION", channel: "WHATSAPP", subject: null, body: "Contenido" })).toBe(true);
  });
});
