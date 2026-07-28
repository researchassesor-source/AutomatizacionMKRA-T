import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasPlausibleFormTiming, leadInputSchema, manualContactInputSchema, normalizeEcuadorPhone } from "./leads";

const valid = {
  firstName: "Ana María",
  lastName: "Pérez López",
  email: "ANA@EXAMPLE.COM",
  phone: "0982716252",
  courseSlug: "curso-prueba",
  consent: true,
  formStartedAt: Date.now() - 3000,
  idempotencyKey: "test_event_12345",
  website: "",
};

describe("captación de contactos", () => {
  it("exige WhatsApp", () => expect(leadInputSchema.safeParse({ ...valid, phone: "" }).success).toBe(false));
  it("rechaza WhatsApp inválido", () => expect(leadInputSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false));
  it("rechaza letras en WhatsApp", () => expect(leadInputSchema.safeParse({ ...valid, phone: "09827ABC52" }).success).toBe(false));
  it("normaliza un número nacional de Ecuador", () => expect(normalizeEcuadorPhone("0982716252")).toBe("+593982716252"));
  it("normaliza un número internacional de Ecuador", () => expect(normalizeEcuadorPhone("593 982 716 252")).toBe("+593982716252"));
  it("rechaza correo inválido", () => expect(leadInputSchema.safeParse({ ...valid, email: "correo" }).success).toBe(false));
  it("exige consentimiento", () => expect(leadInputSchema.safeParse({ ...valid, consent: false }).success).toBe(false));
  it("conserva UTM válidos y normaliza el correo", () => {
    const parsed = leadInputSchema.parse({ ...valid, utmSource: "facebook", utmMedium: "social", utmCampaign: "curso_julio" });
    expect(parsed).toMatchObject({ email: "ana@example.com", utmSource: "facebook", utmCampaign: "curso_julio" });
  });
  it("rechaza parámetros UTM peligrosos", () => expect(leadInputSchema.safeParse({ ...valid, utmCampaign: "<script>" }).success).toBe(false));
  it("detecta envíos demasiado rápidos y formularios vencidos", () => {
    const now = Date.now();
    expect(hasPlausibleFormTiming(now - 200, now)).toBe(false);
    expect(hasPlausibleFormTiming(now - 3 * 60 * 60 * 1000, now)).toBe(false);
    expect(hasPlausibleFormTiming(now - 2000, now)).toBe(true);
  });
});

describe("contacto manual", () => {
  const manual = {
    fullName: "Persona Ficticia",
    phone: "0982716252",
    email: "",
    courseId: "",
    source: "prueba local",
    assignedToId: "",
    consent: true,
  };

  it("acepta el correo vacío y normaliza WhatsApp", () => {
    expect(manualContactInputSchema.parse(manual)).toMatchObject({ email: "", phone: "+593982716252" });
  });
  it("rechaza un correo opcional cuando tiene formato inválido", () => {
    expect(manualContactInputSchema.safeParse({ ...manual, email: "correo" }).success).toBe(false);
  });
  it("mantiene WhatsApp y consentimiento como obligatorios", () => {
    expect(manualContactInputSchema.safeParse({ ...manual, phone: "" }).success).toBe(false);
    expect(manualContactInputSchema.safeParse({ ...manual, consent: false }).success).toBe(false);
  });
  it("registra el curso como interés sin crear una inscripción", () => {
    const source = readFileSync(new URL("../app/api/admin/leads/route.ts", import.meta.url), "utf8");
    expect(source).toContain("courseId: course?.id");
    expect(source).not.toContain("tx.enrollment.create");
  });
});
