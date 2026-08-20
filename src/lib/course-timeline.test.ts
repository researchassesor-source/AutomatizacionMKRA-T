import { describe, expect, it } from "vitest";
import { buildCourseTimeline, TIMELINE_STEPS, type TimelineRule } from "./course-timeline";

function regla(overrides: Partial<TimelineRule> & Pick<TimelineRule, "planKey" | "channel">): TimelineRule {
  return {
    id: `${overrides.planKey}-${overrides.channel}`,
    name: "Regla de prueba",
    status: "ACTIVE",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 0,
    requiresStreamUrl: false,
    waTemplateName: overrides.channel === "WHATSAPP" ? "plantilla_aprobada" : null,
    ...overrides,
  };
}

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

/**
 * Sección C del cierre de producción: un paso con un solo canal ACTIVE (de
 * dos disponibles) es un paso a medias, no uno completo. Antes `blockedReason`
 * solo miraba `rules.length === 0`, así que en cuanto existía UNA regla
 * (aunque fuera de un solo canal) el paso se mostraba como "Se enviará" sin
 * avisar que faltaba el otro -el bug real que reportó el usuario para
 * `welcome`: correo ACTIVE, WhatsApp inexistente-.
 */
describe("buildCourseTimeline: un solo canal activo es un paso a medias", () => {
  it("solo correo ACTIVE (WhatsApp nunca configurado): activo, pero con motivo explícito", () => {
    const steps = buildCourseTimeline({ rules: [regla({ planKey: "welcome", channel: "EMAIL" })], sessions: [] });
    const welcome = steps.find((s) => s.planKey === "welcome");
    expect(welcome?.active).toBe(true);
    expect(welcome?.channels).toEqual(["EMAIL"]);
    expect(welcome?.blockedReason).toBe("Falta activar WhatsApp.");
  });

  it("solo WhatsApp ACTIVE (correo nunca configurado): mismo aviso, canal contrario", () => {
    const steps = buildCourseTimeline({ rules: [regla({ planKey: "welcome", channel: "WHATSAPP" })], sessions: [] });
    const welcome = steps.find((s) => s.planKey === "welcome");
    expect(welcome?.active).toBe(true);
    expect(welcome?.blockedReason).toBe("Falta activar el correo.");
  });

  it("correo ACTIVE y WhatsApp PAUSED: sigue a medias, no basta con que la regla exista", () => {
    const steps = buildCourseTimeline({
      rules: [
        regla({ planKey: "welcome", channel: "EMAIL", status: "ACTIVE" }),
        regla({ planKey: "welcome", channel: "WHATSAPP", status: "PAUSED" }),
      ],
      sessions: [],
    });
    const welcome = steps.find((s) => s.planKey === "welcome");
    expect(welcome?.blockedReason).toBe("Falta activar WhatsApp.");
  });

  it("ambos canales ACTIVE: sin motivo de bloqueo por canales (el paso queda completo)", () => {
    const steps = buildCourseTimeline({
      rules: [
        regla({ planKey: "welcome", channel: "EMAIL", status: "ACTIVE" }),
        regla({ planKey: "welcome", channel: "WHATSAPP", status: "ACTIVE" }),
      ],
      sessions: [],
    });
    const welcome = steps.find((s) => s.planKey === "welcome");
    expect(welcome?.blockedReason).toBeNull();
  });

  it("ARCHIVED no cuenta como canal disponible: un correo archivado y WhatsApp activo sigue pidiendo el correo", () => {
    const steps = buildCourseTimeline({
      rules: [
        regla({ planKey: "welcome", channel: "EMAIL", status: "ARCHIVED" }),
        regla({ planKey: "welcome", channel: "WHATSAPP", status: "ACTIVE" }),
      ],
      sessions: [],
    });
    const welcome = steps.find((s) => s.planKey === "welcome");
    // ARCHIVED se filtra antes de llegar a `rules` (ver buildCourseTimeline),
    // así que este paso se ve con una sola regla viva: WhatsApp.
    expect(welcome?.blockedReason).toBe("Falta activar el correo.");
  });
});
