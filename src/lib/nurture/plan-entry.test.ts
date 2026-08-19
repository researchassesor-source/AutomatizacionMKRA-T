import { describe, expect, it } from "vitest";
import { TIMELINE_STEPS } from "@/lib/course-timeline";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";
import { availableChannelsFor, planEntryFor } from "./plan-entry";

describe("planEntryFor", () => {
  it("resuelve el correo estandar de whatsapp_group sin inventar copy", () => {
    const entry = planEntryFor("whatsapp_group", "EMAIL");
    expect(entry).toMatchObject({ trigger: "ON_REGISTRATION", offsetMinutes: 2, subject: "Informacion inicial de {{curso}}" });
    expect(entry?.body).toContain("{{link_grupo_whatsapp}}");
    expect(entry?.waTemplateName).toBeNull();
  });

  it("resuelve el WhatsApp de whatsapp_group con la plantilla exacta aprobada en Meta", () => {
    const entry = planEntryFor("whatsapp_group", "WHATSAPP");
    expect(entry?.waTemplateName).toBe(WHATSAPP_TEMPLATES.whatsapp_group.name);
    expect(entry?.waTemplateLanguage).toBe(WHATSAPP_TEMPLATES.whatsapp_group.language);
    expect(entry?.waTemplateBodyVars).toEqual(WHATSAPP_TEMPLATES.whatsapp_group.bodyVars);
    expect(entry?.subject).toBeNull();
  });

  it("certification_offer no es un paso del recorrido: no resuelve en ningun canal", () => {
    expect(planEntryFor("certification_offer", "EMAIL")).toBeNull();
    expect(planEntryFor("certification_offer", "WHATSAPP")).toBeNull();
  });

  it("un planKey inventado no resuelve en ningun canal", () => {
    expect(planEntryFor("paso-inventado", "EMAIL")).toBeNull();
    expect(planEntryFor("paso-inventado", "WHATSAPP")).toBeNull();
  });

  it("los once pasos del recorrido resuelven en ambos canales", () => {
    for (const step of TIMELINE_STEPS) {
      expect(planEntryFor(step.planKey, "EMAIL"), step.planKey).not.toBeNull();
      expect(planEntryFor(step.planKey, "WHATSAPP"), step.planKey).not.toBeNull();
    }
  });
});

describe("availableChannelsFor", () => {
  it("los once pasos ofrecen correo y whatsapp", () => {
    for (const step of TIMELINE_STEPS) {
      expect(availableChannelsFor(step.planKey), step.planKey).toEqual(expect.arrayContaining(["EMAIL", "WHATSAPP"]));
    }
  });

  it("certification_offer no ofrece ningun canal (no es un paso del recorrido)", () => {
    expect(availableChannelsFor("certification_offer")).toEqual([]);
  });
});
