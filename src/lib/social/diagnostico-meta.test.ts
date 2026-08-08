import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaAdapter } from "./adapters/meta";

/**
 * El diagnostico no puede acusar a la configuracion de un error propio.
 *
 * La primera version pedia `/{pageId}?fields=tasks`. `tasks` no es un campo
 * del nodo Page —solo existe en las entradas de `/me/accounts`— asi que Meta
 * respondia `(#100) Tried accessing nonexisting field (tasks)` y el
 * diagnostico lo traducia a "permisos insuficientes". Mandaba a revisar unos
 * permisos que estaban bien, y ocultaba la causa real.
 */

const CONFIG = { accessToken: "t", pageId: "1190035477534301", graphVersion: "v25.0" };

/** Responde a cada ruta de Graph segun lo que pida, como haria la API real. */
function graphFalso(rutas: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    for (const [fragmento, cuerpo] of Object.entries(rutas)) {
      if (url.includes(fragmento)) return new Response(JSON.stringify(cuerpo), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: "ruta no simulada", code: 100 } }), { status: 400 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("consultas que hace el diagnóstico", () => {
  const fuente = readFileSync(join(process.cwd(), "src/lib/social/adapters/meta.ts"), "utf8");

  it("NUNCA pide tasks como campo del nodo Page", () => {
    // Esta es la comprobación que pidió la auditoría: si alguien vuelve a
    // escribir `{pageId}?fields=...tasks...`, esto falla.
    const consultasAlNodoPage = [...fuente.matchAll(/\$\{(?:this\.)?pageId\}\?fields=([^`"']+)/g)].map((m) => m[1]);
    expect(consultasAlNodoPage.length).toBeGreaterThan(0);
    for (const campos of consultasAlNodoPage) {
      expect(campos.split(","), `campos pedidos al nodo Page: ${campos}`).not.toContain("tasks");
    }
  });

  it("pide la identidad de la página con los campos válidos", () => {
    expect(fuente).toMatch(/\$\{this\.pageId\}\?fields=id,name/);
  });

  it("lee los permisos por /me/permissions", () => {
    expect(fuente).toContain("me/permissions");
  });

  it("busca las tareas en /me/accounts, que es donde existen", () => {
    expect(fuente).toMatch(/me\/accounts\?fields=id,name,tasks/);
  });
});

describe("un token de usuario del sistema no produce falsos negativos", () => {
  it("si /me/accounts no trae la página, las tareas son NO VERIFICABLES", async () => {
    // Un usuario del sistema no "tiene páginas" como una persona: la arista
    // puede venir vacía estando todo correcto.
    graphFalso({
      "me?fields=id,name": { id: "1", name: "Sistema R.A." },
      "me/permissions": { data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "pages_read_engagement", status: "granted" }] },
      "me/accounts": { data: [] },
      "fields=id,name": { id: CONFIG.pageId, name: "Research Assessor & Training" },
      "fields=access_token": { error: { message: "no derivable", code: 100 } },
    });

    const informe = await new MetaAdapter("FACEBOOK", CONFIG).diagnose();

    expect(informe.tareasVerificables).toBe(false);
    expect(informe.tareasMotivo).toBe("Tareas no verificables con este tipo de token");
    // Lo importante: no se convierte en "faltan permisos".
    expect(informe.scopesRequeridosAusentes).toEqual([]);
    expect(informe.paginaAccesible).toBe(true);
  });

  it("no poder derivar el token de página no se declara como permiso ausente", async () => {
    graphFalso({
      "me?fields=id,name": { id: "1", name: "Sistema R.A." },
      "me/permissions": { data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "pages_read_engagement", status: "granted" }] },
      "me/accounts": { data: [] },
      "fields=id,name": { id: CONFIG.pageId, name: "Research Assessor & Training" },
      "fields=access_token": { error: { message: "no derivable", code: 100 } },
    });

    const informe = await new MetaAdapter("FACEBOOK", CONFIG).diagnose();

    expect(informe.tokenDePaginaDisponible).toBe(false);
    expect(String(informe.tokenDePaginaMotivo)).toContain("No verificable");
    expect(String(informe.tokenDePaginaMotivo)).toContain("no impide publicar");
  });

  it("leer la página NUNCA implica que se pueda publicar", async () => {
    graphFalso({
      "me?fields=id,name": { id: "1", name: "Sistema R.A." },
      "me/permissions": { data: [] },
      "me/accounts": { data: [] },
      "fields=id,name": { id: CONFIG.pageId, name: "Research Assessor & Training" },
      "fields=access_token": {},
    });

    const informe = await new MetaAdapter("FACEBOOK", CONFIG).diagnose();

    expect(informe.paginaAccesible).toBe(true);
    expect(informe.publicacionVerificada).toBe(false);
    expect(String(informe.publicacionMotivo)).toContain("envío real");
  });
});

describe("cuando los permisos SÍ faltan, se dicen por su nombre", () => {
  it("nombra los scopes ausentes leídos de /me/permissions", async () => {
    graphFalso({
      "me?fields=id,name": { id: "1", name: "Sistema R.A." },
      "me/permissions": { data: [{ permission: "instagram_content_publish", status: "granted" }] },
      "me/accounts": { data: [{ id: CONFIG.pageId, name: "RA", tasks: ["ANALYZE"] }] },
      "fields=id,name": { id: CONFIG.pageId, name: "Research Assessor & Training" },
      "fields=access_token": {},
    });

    const informe = await new MetaAdapter("FACEBOOK", CONFIG).diagnose();

    expect(informe.scopesVerificables).toBe(true);
    expect(informe.scopesRequeridosAusentes).toEqual(["pages_manage_posts", "pages_read_engagement"]);
    // Aquí las tareas SÍ se pudieron verificar, y falta CREATE_CONTENT.
    expect(informe.tareasVerificables).toBe(true);
    expect(informe.tareasSobreLaPagina).toEqual(["ANALYZE"]);
  });

  it("si la página no responde, se informa como página inaccesible", async () => {
    graphFalso({
      "me?fields=id,name": { id: "1", name: "Sistema R.A." },
      "me/permissions": { data: [] },
      "me/accounts": { data: [] },
      "fields=id,name": { error: { message: "Unsupported get request", code: 100 } },
      "fields=access_token": {},
    });

    const informe = await new MetaAdapter("FACEBOOK", CONFIG).diagnose();

    expect(informe.paginaAccesible).toBe(false);
    expect(String(informe.paginaMotivo)).toContain("Unsupported get request");
  });
});
