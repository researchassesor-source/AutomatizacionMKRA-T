import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Hallazgo de producción: el botón "Sincronizar con la web" mandaba
 * `{ confirm: true }`, y /api/admin/courses/catalog/sync exige el literal
 * `"SYNC_WORDPRESS_READ_ONLY"`. El resultado era un 422 silencioso en cada
 * intento — el catálogo nunca se sincronizaba desde este botón.
 */
const source = readFileSync(join(process.cwd(), "src/app/admin/cursos/SyncEverythingButton.tsx"), "utf8");
const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/admin/courses/catalog/sync/route.ts"),
  "utf8",
);

describe("payload de sincronización de catálogo", () => {
  it("manda exactamente el literal que exige el endpoint", () => {
    expect(source).toContain('body: JSON.stringify({ confirm: "SYNC_WORDPRESS_READ_ONLY" })');
    expect(source).not.toContain("confirm: true");
  });

  it("el literal coincide con lo que la ruta realmente exige", () => {
    expect(routeSource).toContain('z.literal("SYNC_WORDPRESS_READ_ONLY")');
  });

  it("un error de catálogo no crea nada automáticamente: solo avisa y sigue leyendo", () => {
    const trasSync = source.slice(source.indexOf("if (sync && !sync.ok)"), source.indexOf("async function confirmar"));
    expect(trasSync).not.toMatch(/method:\s*"POST"/);
    // Solo el clic explícito en "confirmar" crea sesiones.
    expect(source).toContain("Nada se crea hasta que confirmes");
    expect(source).toContain("onClick={confirmar}");
  });
});
