import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasPlausibleFormTiming, leadInputSchema, manualContactInputSchema, normalizeEcuadorPhone } from "./leads";

const valid = {
  firstName: "Ana Mar\u00eda",
  lastName: "P\u00e9rez L\u00f3pez",
  email: "ANA@EXAMPLE.COM",
  phone: "0982716252",
  courseSlug: "curso-prueba",
  consent: true,
  formStartedAt: Date.now() - 3000,
  idempotencyKey: "test_event_12345",
  website: "",
};

describe("captacion de contactos", () => {
  it("rechaza nombre vacio", () => expect(leadInputSchema.safeParse({ ...valid, firstName: "  " }).success).toBe(false));
  it("rechaza nombre corto", () => expect(leadInputSchema.safeParse({ ...valid, firstName: "A" }).success).toBe(false));
  it("acepta nombre con tildes, apostrofe y guion", () => {
    expect(leadInputSchema.parse({ ...valid, firstName: "Mar\u00eda-Jos\u00e9", lastName: "D'\u00c1vila P\u00e9rez" })).toMatchObject({
      firstName: "Mar\u00eda-Jos\u00e9",
      lastName: "D'\u00c1vila P\u00e9rez",
    });
  });
  it("rechaza nombres compuestos solo por simbolos", () => {
    expect(leadInputSchema.safeParse({ ...valid, firstName: "--" }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...valid, lastName: "''" }).success).toBe(false);
  });
  it("rechaza apellidos vacios", () => expect(leadInputSchema.safeParse({ ...valid, lastName: "" }).success).toBe(false));
  it("exige correo electronico", () => {
    const parsed = leadInputSchema.safeParse({ ...valid, email: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.errors[0]?.message).toBe("Ingresa tu correo electr\u00f3nico.");
  });
  it("rechaza correo invalido", () => expect(leadInputSchema.safeParse({ ...valid, email: "correo" }).success).toBe(false));
  it("exige WhatsApp", () => expect(leadInputSchema.safeParse({ ...valid, phone: "" }).success).toBe(false));
  it("rechaza WhatsApp invalido", () => expect(leadInputSchema.safeParse({ ...valid, phone: "12345" }).success).toBe(false));
  it("rechaza letras en WhatsApp", () => expect(leadInputSchema.safeParse({ ...valid, phone: "09827ABC52" }).success).toBe(false));
  it("normaliza numero nacional de Ecuador", () => expect(normalizeEcuadorPhone("0982716252")).toBe("+593982716252"));
  it("normaliza numero internacional sin +", () => expect(normalizeEcuadorPhone("593 982 716 252")).toBe("+593982716252"));
  it("normaliza numero internacional con +", () => expect(normalizeEcuadorPhone("+593982716252")).toBe("+593982716252"));
  it("exige consentimiento", () => expect(leadInputSchema.safeParse({ ...valid, consent: false }).success).toBe(false));
  it("conserva las UTMs y normaliza el correo", () => {
    const parsed = leadInputSchema.parse({
      ...valid,
      utmSource: "facebook",
      utmMedium: "social",
      utmCampaign: "curso_julio",
      utmContent: "video_01",
      utmTerm: "profesores",
      fbclid: "fb_123",
      gclid: "google_123",
      ttclid: "tiktok_123",
      landingUrl: "https://ra-training.com/cursos/curso/",
      referrer: "https://facebook.com/",
    });
    expect(parsed).toMatchObject({
      email: "ana@example.com",
      utmSource: "facebook",
      utmMedium: "social",
      utmCampaign: "curso_julio",
      utmContent: "video_01",
      utmTerm: "profesores",
      fbclid: "fb_123",
      gclid: "google_123",
      ttclid: "tiktok_123",
      landingUrl: "https://ra-training.com/cursos/curso/",
      referrer: "https://facebook.com/",
    });
  });
  it("ignora parametros UTM peligrosos sin bloquear la captura", () => {
  const parsed = leadInputSchema.parse({
    ...valid,
    utmCampaign: "<script>",
  });

  expect(parsed.utmCampaign).toBeUndefined();
  expect(parsed.firstName).toBe("Ana María");
  expect(parsed.email).toBe("ana@example.com");
});

it("limita nombres y correo, pero ignora UTMs excesivas", () => {
  expect(
    leadInputSchema.safeParse({
      ...valid,
      firstName: "A".repeat(81),
    }).success,
  ).toBe(false);

  expect(
    leadInputSchema.safeParse({
      ...valid,
      email: `${"a".repeat(250)}@example.test`,
    }).success,
  ).toBe(false);

  const parsed = leadInputSchema.parse({
    ...valid,
    utmContent: "a".repeat(121),
  });

  expect(parsed.utmContent).toBeUndefined();
  expect(parsed.courseSlug).toBe("curso-prueba");
  expect(parsed.phone).toBe("+593982716252");
});
  it("exige un slug de curso valido", () => {
    expect(leadInputSchema.safeParse({ ...valid, courseSlug: "" }).success).toBe(false);
    expect(leadInputSchema.safeParse({ ...valid, courseSlug: "<script>" }).success).toBe(false);
  });
  it("conserva el honeypot para que el endpoint detecte bots", () => {
    expect(leadInputSchema.parse({ ...valid, website: "bot" }).website).toBe("bot");
  });
  it("detecta envios demasiado rapidos y formularios vencidos", () => {
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

  it("acepta el correo vacio y normaliza WhatsApp", () => {
    expect(manualContactInputSchema.parse(manual)).toMatchObject({ email: "", phone: "+593982716252" });
  });
  it("rechaza un correo opcional invalido", () => {
    expect(manualContactInputSchema.safeParse({ ...manual, email: "correo" }).success).toBe(false);
  });
  it("mantiene WhatsApp y consentimiento obligatorios", () => {
    expect(manualContactInputSchema.safeParse({ ...manual, phone: "" }).success).toBe(false);
    expect(manualContactInputSchema.safeParse({ ...manual, consent: false }).success).toBe(false);
  });
  it("registra el curso como interes sin crear una inscripcion", () => {
    const source = readFileSync(new URL("../app/api/admin/leads/route.ts", import.meta.url), "utf8");
    expect(source).toContain("courseId: course?.id");
    expect(source).not.toContain("tx.enrollment.create");
  });
});
