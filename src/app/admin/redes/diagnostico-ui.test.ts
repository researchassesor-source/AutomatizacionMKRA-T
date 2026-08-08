import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrato entre el diagnostico del servidor y lo que se pinta.
 *
 * El fallo previo: el endpoint devolvia el diagnostico completo y la interfaz
 * solo refrescaba el badge y la hora. La informacion existia y no la veia
 * nadie, que a efectos practicos es lo mismo que no tenerla.
 *
 * Estas comprobaciones leen el codigo fuente. Es barato, no necesita navegador,
 * y falla si alguien añade un campo al informe sin pintarlo o pinta uno que el
 * servidor no manda.
 */
const raiz = join(process.cwd(), "src");
const manager = readFileSync(join(raiz, "app/admin/redes/RedesManager.tsx"), "utf8");
const ruta = readFileSync(join(raiz, "app/api/admin/social/diagnose/route.ts"), "utf8");
const adaptador = readFileSync(join(raiz, "lib/social/adapters/meta.ts"), "utf8");

/** Los trece datos que la auditoría pidió ver en pantalla. */
const CAMPOS_EXIGIDOS = [
  "paginaAccesible",
  "pageIdSolicitado",
  "pageIdEfectivo",
  "nombreDeLaPagina",
  "identidadDelToken",
  "scopesVerificables",
  "scopesRequeridosPresentes",
  "scopesRequeridosAusentes",
  "tareasVerificables",
  "tareasSobreLaPagina",
  "tokenDePaginaDisponible",
  "publicacionVerificada",
  "motivoFinal",
];

describe("la interfaz consume el diagnóstico", () => {
  it("«Comprobar estado» llama al endpoint de diagnóstico", () => {
    expect(manager).toContain('request("/api/admin/social/diagnose", "POST", { accountId: account.id })');
  });

  it("solo lo pide para Facebook e Instagram", () => {
    // TikTok tiene su propio panel; pedirselo devolveria 422 y ensuciaria la
    // pantalla con un error que no significa nada.
    expect(manager).toMatch(/account\.platform !== "FACEBOOK" && account\.platform !== "INSTAGRAM"/);
  });

  it("renderiza el bloque desplegable con el resultado", () => {
    expect(manager).toContain("<DiagnosticoMeta datos={diagnostico[account.id]} />");
    expect(manager).toMatch(/<details className="diagnostico">/);
  });

  it("pinta los trece datos exigidos", () => {
    for (const campo of CAMPOS_EXIGIDOS) {
      expect(manager, `falta pintar ${campo}`).toContain(`datos.${campo}`);
    }
  });

  it("cada dato que pinta lo produce el servidor", () => {
    // Pintar un campo que nadie manda deja un "—" permanente que parece un
    // fallo de configuracion y no lo es.
    const producidos = `${adaptador}\n${ruta}`;
    for (const campo of CAMPOS_EXIGIDOS) {
      expect(producidos, `el servidor no produce ${campo}`).toContain(campo);
    }
  });
});

describe("nada de esto expone secretos", () => {
  it("el diagnóstico no pinta tokens ni secretos", () => {
    const bloque = manager.slice(manager.indexOf("function DiagnosticoMeta"));
    expect(bloque).not.toMatch(/accessToken|appSecret|META_SYSTEM_USER_TOKEN|META_APP_SECRET|Bearer/);
  });

  it("el endpoint tampoco los devuelve", () => {
    expect(ruta).not.toMatch(/accessToken|appSecret/);
  });

  it("el informe solo expone el tipo del token, nunca su valor", () => {
    // debug_token recibe el token, pero de su respuesta solo se toma `type`.
    const bloque = adaptador.slice(adaptador.indexOf("leerTipoDeToken"));
    expect(bloque).toMatch(/info\.type/);
    expect(bloque).not.toMatch(/tokenDelSistema|devolver.*accessToken/);
  });
});

describe("conexión validada no significa que pueda publicar", () => {
  it("la publicación verificada sale del historial, no de la Graph API", () => {
    expect(ruta).toMatch(/status: "PUBLICADO"/);
    expect(ruta).toMatch(/externalPostId: \{ not: null \}/);
  });

  it("el adaptador nunca declara la publicación verificada por su cuenta", () => {
    expect(adaptador).toMatch(/publicacionVerificada: false/);
  });

  it("una comprobación no verificable no se convierte en un problema", () => {
    // Es la regla que hizo falta escribir despues de que el diagnostico
    // acusara de permisos insuficientes por un error propio.
    expect(ruta).toMatch(/scopesVerificables \|\| !graph\.tareasVerificables/);
    expect(ruta).toContain("no todo puede verificarse desde aquí");
  });
});
