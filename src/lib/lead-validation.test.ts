import { describe, expect, it } from "vitest";
import { leadInputSchema } from "./lead-validation";

const FACEBOOK_FBCLID =
  "Iwb21leATfdVdjbGNrBN9zgmV4dG4DYWVtAjExAHNydGMGYXBwX2lkDDM1MDY4NTUzMTcyOAABHgNJx65-QaSGAdY6de0XtAe1uOU4BxNIp2fMXB5NwwBMX6yVUIgymj0pHMOg_aem_UgwzXqcXbdCoKmfXYCsR3w";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Sabine",
    lastName: "García",
    email: "sabine.garcia555@gmail.com",
    phone: "0979091215",
    consent: true,
    courseSlug: "ia-apoyo-tareas-estudiantiles",
    source: "facebook",
    utmSource: "facebook",
    utmMedium: "paid_social",
    utmCampaign: "curso_agosto",
    fbclid: FACEBOOK_FBCLID,
    landingUrl:
      "https://automatizacion-mkra-t2.vercel.app/cursos/ia-apoyo-tareas-estudiantiles",
    referrer: "https://www.facebook.com/",
    website: "",
    formStartedAt: Date.now() - 3000,
    idempotencyKey: "facebook_validation_test_001",
    ...overrides,
  };
}

describe("validación de atribución publicitaria", () => {
  it("acepta el fbclid real generado por Facebook", () => {
    const result = leadInputSchema.parse(validPayload());

    expect(result.fbclid).toBe(FACEBOOK_FBCLID);
    expect(result.phone).toBe("+593979091215");
  });

  it("ignora un click id excesivo sin bloquear la inscripción", () => {
    const result = leadInputSchema.parse(
      validPayload({
        fbclid: "a".repeat(513),
        idempotencyKey: "facebook_validation_test_002",
      }),
    );

    expect(result.fbclid).toBeUndefined();
    expect(result.utmCampaign).toBe("curso_agosto");
    expect(result.email).toBe("sabine.garcia555@gmail.com");
  });

  it("ignora parámetros publicitarios inválidos sin bloquear la inscripción", () => {
    const result = leadInputSchema.parse(
      validPayload({
        fbclid: "<script>alert(1)</script>",
        gclid: "valor con espacios inválidos",
        idempotencyKey: "facebook_validation_test_003",
      }),
    );

    expect(result.fbclid).toBeUndefined();
    expect(result.gclid).toBeUndefined();
    expect(result.courseSlug).toBe("ia-apoyo-tareas-estudiantiles");
  });

  it("ignora una campaña excesiva y conserva el registro principal", () => {
    const result = leadInputSchema.parse(
      validPayload({
        utmCampaign: "a".repeat(121),
        idempotencyKey: "facebook_validation_test_004",
      }),
    );

    expect(result.utmCampaign).toBeUndefined();
    expect(result.firstName).toBe("Sabine");
    expect(result.lastName).toBe("García");
  });
});