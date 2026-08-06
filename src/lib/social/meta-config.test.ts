import { describe, expect, it } from "vitest";
import { isPublicHttpsUrl } from "./adapters/meta";
import { DEFAULT_GRAPH_API_VERSION, describeMetaConfig, describeMetaError, resolveMetaConfig } from "./meta-config";

describe("configuración de Meta", () => {
  it("prefiere el token del usuario del sistema sobre el nombre heredado", () => {
    const config = resolveMetaConfig({ META_SYSTEM_USER_TOKEN: "token-nuevo", META_ACCESS_TOKEN: "token-viejo" });
    expect(config.accessToken).toBe("token-nuevo");
  });

  it("acepta el nombre heredado cuando no existe el nuevo", () => {
    expect(resolveMetaConfig({ META_ACCESS_TOKEN: "token-viejo" }).accessToken).toBe("token-viejo");
    expect(resolveMetaConfig({ META_IG_USER_ID: "1784" }).igUserId).toBe("1784");
  });

  it("usa v25.0 por defecto y normaliza el prefijo", () => {
    expect(resolveMetaConfig({}).graphVersion).toBe(DEFAULT_GRAPH_API_VERSION);
    expect(resolveMetaConfig({ META_GRAPH_API_VERSION: "25.0" }).graphVersion).toBe("v25.0");
    expect(resolveMetaConfig({ META_GRAPH_API_VERSION: "no-válida" }).graphVersion).toBe(DEFAULT_GRAPH_API_VERSION);
  });

  it("el resumen para la interfaz nunca incluye el token", () => {
    const summary = describeMetaConfig(resolveMetaConfig({ META_SYSTEM_USER_TOKEN: "token-secreto", META_PAGE_ID: "1190" }));
    expect(JSON.stringify(summary)).not.toContain("token-secreto");
    expect(summary.tokenConfigured).toBe(true);
    expect(summary.pageId).toBe("1190");
  });

  it("traduce los errores de Meta a texto accionable", () => {
    expect(describeMetaError({ code: 190 }).error).toContain("caducó");
    expect(describeMetaError({ code: 200 }).error).toContain("permisos insuficientes");
    expect(describeMetaError({ code: 2207003 }).error).toContain("URL pública");
    expect(describeMetaError({ code: 190 }).errorCode).toBe("META_190");
  });

  it("no filtra el mensaje técnico de Meta en el texto visible", () => {
    const description = describeMetaError({ code: 999, message: "OAuth internal detail #abc" });
    expect(description.error).not.toContain("OAuth internal detail");
  });

  it("exige que el archivo esté en una URL pública HTTPS", () => {
    expect(isPublicHttpsUrl("https://blob.example.com/imagen.jpg")).toBe(true);
    expect(isPublicHttpsUrl("http://blob.example.com/imagen.jpg")).toBe(false);
    expect(isPublicHttpsUrl("https://localhost/imagen.jpg")).toBe(false);
    expect(isPublicHttpsUrl("/ruta/local.jpg")).toBe(false);
  });
});
