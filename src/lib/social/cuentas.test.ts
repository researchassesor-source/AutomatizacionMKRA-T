import { describe, expect, it } from "vitest";
import { cuentasCanonicasPorRed, esCuentaPublicable, motivoNoPublicable } from "./cuentas";

/** Las cuentas reales de producción, tal como están registradas hoy. */
const FB_ACTUAL = { id: "fb-nueva", platform: "FACEBOOK", displayName: "Research Assessor & Training", externalId: "1190035477534301", isActive: true };
const FB_LEGADO = { id: "fb-vieja", platform: "FACEBOOK", displayName: "Ra-training", externalId: "https://www.facebook.com/profile.php?id=61591978980108", isActive: true };
const FB_INACTIVA = { id: "fb-off", platform: "FACEBOOK", displayName: "Varilex kira", externalId: "", isActive: false };
const IG_ACTUAL = { id: "ig-nueva", platform: "INSTAGRAM", displayName: "fernando_ba77", externalId: "17841403176483044", isActive: true };
const IG_LEGADO = { id: "ig-vieja", platform: "INSTAGRAM", displayName: "fernando_ba77", externalId: "https://www.instagram.com/fernando_ba77/", isActive: true };
const TIKTOK = { id: "tt", platform: "TIKTOK", displayName: "ratraining", externalId: "-000Mun5AS-QbP0yOf6Y6J_-tjbsSlvRGsRY", isActive: true };

describe("qué cuenta puede ser destino", () => {
  it("acepta las cuentas de Meta con identificador real", () => {
    expect(esCuentaPublicable(FB_ACTUAL)).toBe(true);
    expect(esCuentaPublicable(IG_ACTUAL)).toBe(true);
  });

  it("rechaza las cuentas antiguas que guardaron la URL del perfil", () => {
    // Publicarian en la pagina de la variable de entorno, no en la que dice su
    // nombre: publicar en el sitio equivocado creyendo que se acerto.
    expect(esCuentaPublicable(FB_LEGADO)).toBe(false);
    expect(esCuentaPublicable(IG_LEGADO)).toBe(false);
  });

  it("rechaza las desactivadas y las que no tienen identificador", () => {
    expect(esCuentaPublicable(FB_INACTIVA)).toBe(false);
    expect(esCuentaPublicable({ ...FB_ACTUAL, isActive: false })).toBe(false);
  });

  it("no aplica la regla numérica a TikTok, cuyos identificadores llevan guiones", () => {
    expect(esCuentaPublicable(TIKTOK)).toBe(true);
  });

  it("explica el motivo en lenguaje humano, sin jerga", () => {
    expect(motivoNoPublicable(FB_ACTUAL)).toBeNull();
    const motivo = motivoNoPublicable(FB_LEGADO);
    expect(motivo).toContain("registro antiguo");
    expect(motivo).not.toMatch(/externalId|null|Graph|API/);
    expect(motivoNoPublicable(FB_INACTIVA)).toContain("desactivada");
  });
});

describe("una cuenta por red", () => {
  it("elige la cuenta buena aunque la antigua venga primero", () => {
    const elegidas = cuentasCanonicasPorRed([FB_LEGADO, FB_ACTUAL, IG_LEGADO, IG_ACTUAL]);
    expect(elegidas.map((c) => c.id).sort()).toEqual(["fb-nueva", "ig-nueva"]);
  });

  it("mantiene la elección aunque la buena venga primero", () => {
    const elegidas = cuentasCanonicasPorRed([FB_ACTUAL, FB_LEGADO]);
    expect(elegidas.map((c) => c.id)).toEqual(["fb-nueva"]);
  });

  it("no ofrece ninguna cuenta de una red que solo tiene registros antiguos", () => {
    // Es preferible no poder publicar a publicar en la pagina equivocada.
    expect(cuentasCanonicasPorRed([FB_LEGADO, FB_INACTIVA])).toEqual([]);
  });

  it("devuelve exactamente una por red, sin duplicar destinos", () => {
    const elegidas = cuentasCanonicasPorRed([FB_LEGADO, FB_ACTUAL, IG_LEGADO, IG_ACTUAL, TIKTOK]);
    const redes = elegidas.map((c) => c.platform);
    expect(new Set(redes).size).toBe(redes.length);
    expect(redes.sort()).toEqual(["FACEBOOK", "INSTAGRAM", "TIKTOK"]);
  });
});
