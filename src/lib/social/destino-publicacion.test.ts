import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAccountId } from "./adapters/meta";

/**
 * A que cuenta se publica, y por que no puede volver a decidirlo el entorno.
 *
 * El fallo que motiva esto: el adaptador se construia solo con
 * `resolveMetaConfig()`, asi que publicaba SIEMPRE en `META_PAGE_ID` sin mirar
 * la cuenta elegida en el panel. Elegir "Research Assessor & Training" o la
 * pagina antigua daba exactamente el mismo resultado, y nadie podia notarlo
 * desde la interfaz.
 */
describe("identificador de la cuenta de destino", () => {
  it("acepta el identificador numérico de Meta", () => {
    expect(normalizeAccountId("1190035477534301")).toBe("1190035477534301");
    expect(normalizeAccountId("  17841403176483044  ")).toBe("17841403176483044");
  });

  it("descarta los registros antiguos que guardaron una URL en vez del id", () => {
    // En la base hay cuentas creadas a mano cuyo externalId es la URL del
    // perfil. Pasarselas a Graph produce un 404 confuso; es mejor caer en la
    // variable de entorno, que es el comportamiento anterior y conocido.
    expect(normalizeAccountId("https://www.facebook.com/profile.php?id=61591978980108")).toBeNull();
    expect(normalizeAccountId("https://www.instagram.com/fernando_ba77/")).toBeNull();
    expect(normalizeAccountId("@ratraining")).toBeNull();
  });

  it("trata vacío y ausente como «sin identificador»", () => {
    expect(normalizeAccountId("")).toBeNull();
    expect(normalizeAccountId("   ")).toBeNull();
    expect(normalizeAccountId(null)).toBeNull();
    expect(normalizeAccountId(undefined)).toBeNull();
  });
});

describe("el orquestador pasa la cuenta al adaptador", () => {
  const orquestador = readFileSync(join(process.cwd(), "src/lib/social/orchestrator.ts"), "utf8");

  it("publica usando el externalId de la cuenta elegida", () => {
    expect(orquestador).toContain("getAdapter(post.account.platform, post.account.externalId)");
  });

  it("el adaptador de Meta recibe el destino, no solo la configuración", () => {
    expect(orquestador).toMatch(/new MetaAdapter\("FACEBOOK", metaConfig, targetId\)/);
    expect(orquestador).toMatch(/new MetaAdapter\("INSTAGRAM", metaConfig, targetId\)/);
  });
});

describe("el caption ya no se compone al publicar", () => {
  const adaptador = readFileSync(join(process.cwd(), "src/lib/social/adapters/meta.ts"), "utf8");

  it("el adaptador no vuelve a pegar la URL al caption", () => {
    // Si lo hiciera, la URL aparecería dos veces: una puesta al crear la
    // publicación y otra aquí.
    expect(adaptador).not.toMatch(/input\.linkUrl \? `\$\{input\.caption\}/);
    expect(adaptador).toMatch(/const caption = input\.caption/);
  });

  it("el camino de publicación no cambia mientras no se confirme la causa", () => {
    // Publicar con token de pagina es candidato a resolver el rechazo 200 de
    // Meta, pero cambiarlo antes de confirmar la causa podria enmascarar el
    // problema. De momento solo se DIAGNOSTICA si ese token puede derivarse.
    expect(adaptador).toMatch(/fields=tasks,access_token/);
    expect(adaptador).not.toMatch(/pageAccessToken/);
  });
});
