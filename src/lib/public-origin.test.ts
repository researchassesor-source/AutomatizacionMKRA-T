import { describe, expect, it } from "vitest";
import { isAllowedPublicLeadOrigin, publicLeadCorsHeaders } from "./public-origin";

const requestUrl = "https://preview-feature.example.test/api/leads";

describe("origenes publicos permitidos", () => {
  it("permite sitio oficial, Produccion, mismo Preview y Preview configurado", () => {
    const env = {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_URL: "preview-feature.example.test",
    } as NodeJS.ProcessEnv;
    expect(isAllowedPublicLeadOrigin("https://ra-training.com", requestUrl, env)).toBe(true);
    expect(isAllowedPublicLeadOrigin("https://www.ra-training.com", requestUrl, env)).toBe(true);
    expect(isAllowedPublicLeadOrigin("https://automatizacion-mkra-t2.vercel.app", requestUrl, env)).toBe(true);
    expect(isAllowedPublicLeadOrigin("https://preview-feature.example.test", requestUrl, env)).toBe(true);
  });

  it("rechaza origenes externos y localhost en Produccion", () => {
    const env = { NODE_ENV: "production", VERCEL_ENV: "production" } as NodeJS.ProcessEnv;
    expect(isAllowedPublicLeadOrigin("https://evil.example.test", requestUrl, env)).toBe(false);
    expect(isAllowedPublicLeadOrigin("http://localhost:3000", requestUrl, env)).toBe(false);
  });

  it("no emite comodin CORS y refleja solo un origen aprobado", () => {
    const headers = publicLeadCorsHeaders("https://ra-training.com", requestUrl);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://ra-training.com");
    expect(headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(headers.get("Vary")).toBe("Origin");
  });
});
