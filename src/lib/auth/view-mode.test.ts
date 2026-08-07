import { describe, expect, it } from "vitest";
import { parseViewMode } from "./view-mode-shared";
import { isTechnicalProfile, profileLabel, CONTENIDO, COMERCIAL, GESTION, TECNICO, CONSULTA, OPERACION } from "./roles";

describe("vista del panel", () => {
  it("solo reconoce las dos vistas reales", () => {
    expect(parseViewMode("direccion")).toBe("direccion");
    expect(parseViewMode("tecnica")).toBe("tecnica");
    for (const raro of [undefined, "", "admin", "TECNICA", "1"]) expect(parseViewMode(raro)).toBeNull();
  });
});

describe("perfiles", () => {
  it("solo el perfil técnico ve la sala de máquinas", () => {
    expect(isTechnicalProfile("ADMIN")).toBe(true);
    for (const rol of ["DIRECCION", "MARKETING", "VENTAS", "LECTURA"] as const) {
      expect(isTechnicalProfile(rol)).toBe(false);
    }
  });

  it("dirección entra en todos los grupos operativos y administrativos", () => {
    // Es la comprobación que faltaba: sin ella dirección se encuentra
    // pantallas vacías sin ningún aviso de que le falta permiso.
    for (const grupo of [CONTENIDO, COMERCIAL, GESTION, CONSULTA, OPERACION]) {
      expect(grupo).toContain("DIRECCION");
    }
  });

  it("dirección nunca entra en la sala de máquinas", () => {
    expect(TECNICO).not.toContain("DIRECCION");
    expect(TECNICO).toEqual(["ADMIN"]);
  });

  it("los perfiles se nombran en español, no con el rol interno", () => {
    expect(profileLabel("ADMIN")).toBe("Técnico");
    expect(profileLabel("DIRECCION")).toBe("Dirección");
  });
});
