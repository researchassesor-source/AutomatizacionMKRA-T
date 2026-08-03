import { describe, expect, it } from "vitest";
import { captureLeadAttribution } from "./lead-attribution";

describe("atribucion de campana", () => {
  it("captura las cinco UTMs, fuente, landing y referrer", () => {
    const result = captureLeadAttribution(
      "?utm_source=facebook&utm_medium=paid_social&utm_campaign=qa_cursos_agosto&utm_content=arte_prueba&utm_term=docentes&fbclid=fb_123&gclid=google_123&ttclid=tiktok_123&source=meta&landing_url=https%3A%2F%2Fra-training.com%2Fcursos%2Fcurso%2F&referrer=https%3A%2F%2Ffacebook.com%2F",
      "https://preview.example.test/cursos/curso",
    );
    expect(result).toEqual({
      source: "meta",
      utmSource: "facebook",
      utmMedium: "paid_social",
      utmCampaign: "qa_cursos_agosto",
      utmContent: "arte_prueba",
      utmTerm: "docentes",
      fbclid: "fb_123",
      gclid: "google_123",
      ttclid: "tiktok_123",
      landingUrl: "https://ra-training.com/cursos/curso/",
      referrer: "https://facebook.com/",
    });
  });

  it("no acepta una landing externa inyectada y conserva la URL del formulario", () => {
    const result = captureLeadAttribution(
      "?landing_url=javascript%3Aalert(1)&referrer=data%3Atext%2Fhtml%2Cbad",
      "https://preview.example.test/cursos/curso",
      "https://outside.example.test/ref",
    );
    expect(result.landingUrl).toBe("https://preview.example.test/cursos/curso");
    expect(result.referrer).toBe("https://outside.example.test/ref");
  });

  it("identifica trafico institucional sin fuente explicita", () => {
    const result = captureLeadAttribution(
      "?landing_url=https%3A%2F%2Fra-training.com%2Fcursos%2Fcurso%2F",
      "https://preview.example.test/cursos/curso",
    );
    expect(result.source).toBe("ra-training.com");
  });
});
