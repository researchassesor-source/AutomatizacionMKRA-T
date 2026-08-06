import { describe, expect, it } from "vitest";
import {
  automationRuleCanRun,
  courseAcceptsAutomations,
  courseAcceptsNewRegistrations,
} from "./automation-eligibility";

const course = {
  isPublished: true,
  acceptsRegistrations: true,
  startsAt: new Date("2026-08-11T00:30:00.000Z"),
  endsAt: new Date("2026-08-14T02:00:00.000Z"),
};

describe("elegibilidad de automatizaciones por curso", () => {
  it("las automatizaciones solo exigen que el curso siga publicado", () => {
    expect(courseAcceptsAutomations(course)).toBe(true);
    expect(courseAcceptsAutomations({ ...course, isPublished: false })).toBe(false);
  });

  it("cerrar inscripciones nuevas no apaga los recordatorios de los ya inscritos", () => {
    // Cerrar el cupo es lo normal cuando el curso está por empezar: si eso
    // detuviera los recordatorios, quienes ya reservaron su lugar perderían el
    // enlace de acceso justo cuando lo necesitan.
    const cupoCerrado = { ...course, acceptsRegistrations: false };
    expect(courseAcceptsAutomations(cupoCerrado)).toBe(true);
    expect(automationRuleCanRun(cupoCerrado, { trigger: "BEFORE_COURSE", channel: "EMAIL", subject: "Mañana", body: "Contenido" })).toBe(true);
  });

  it("el formulario público sí exige el cupo abierto", () => {
    expect(courseAcceptsNewRegistrations(course)).toBe(true);
    expect(courseAcceptsNewRegistrations({ ...course, acceptsRegistrations: false })).toBe(false);
    expect(courseAcceptsNewRegistrations({ ...course, isPublished: false })).toBe(false);
  });

  it("despublicar el curso sí detiene las automatizaciones", () => {
    const despublicado = { ...course, isPublished: false };
    expect(courseAcceptsAutomations(despublicado)).toBe(false);
    expect(automationRuleCanRun(despublicado, { trigger: "BEFORE_COURSE", channel: "EMAIL", subject: "Mañana", body: "Contenido" })).toBe(false);
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
