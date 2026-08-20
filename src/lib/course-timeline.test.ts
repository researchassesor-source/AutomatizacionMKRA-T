import { describe, expect, it } from "vitest";
import { buildCourseTimeline, TIMELINE_STEPS } from "./course-timeline";

describe("buildCourseTimeline: plan estandar de cada paso", () => {
  const steps = buildCourseTimeline({ rules: [], sessions: [] });

  it("devuelve exactamente los once pasos, en el mismo orden que TIMELINE_STEPS", () => {
    expect(steps.map((s) => s.planKey)).toEqual(TIMELINE_STEPS.map((s) => s.planKey));
    expect(steps).toHaveLength(11);
  });

  it("cada paso trae su disparador y desfase por defecto, para prellenar Configurar este paso", () => {
    const whatsappGroup = steps.find((s) => s.planKey === "whatsapp_group");
    expect(whatsappGroup).toMatchObject({ defaultTrigger: "ON_REGISTRATION", defaultOffsetMinutes: 2 });

    const reminder24h = steps.find((s) => s.planKey === "reminder_24h");
    expect(reminder24h).toMatchObject({ defaultTrigger: "BEFORE_COURSE", defaultOffsetMinutes: 24 * 60 });
  });

  it("cada paso ofrece correo y whatsapp como canales disponibles para configurar", () => {
    for (const step of steps) {
      expect(step.availableChannels, step.planKey).toEqual(expect.arrayContaining(["EMAIL", "WHATSAPP"]));
      expect(step.availableChannels).toHaveLength(2);
    }
  });

  it("sin reglas, un paso queda inactivo y sin canales en uso (distinto de availableChannels)", () => {
    const whatsappGroup = steps.find((s) => s.planKey === "whatsapp_group");
    expect(whatsappGroup?.active).toBe(false);
    expect(whatsappGroup?.channels).toEqual([]);
    expect(whatsappGroup?.availableChannels).toEqual(expect.arrayContaining(["EMAIL", "WHATSAPP"]));
  });
});
