import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaAdapter } from "./adapters/meta";

/**
 * Facebook publica con la credencial de la pagina, no con la del sistema.
 *
 * El diagnostico de produccion cerro el caso: el token del usuario del sistema
 * tenia `pages_manage_posts`, `pages_read_engagement`, la tarea CREATE_CONTENT
 * sobre la pagina y el identificador correcto, y aun asi `/{pageId}/photos`
 * devolvia 200. Lo que faltaba era la credencial de pagina.
 *
 * En estas pruebas los dos valores son distinguibles a proposito, para poder
 * comprobar CUAL viaja en cada llamada.
 */
const TOKEN_SISTEMA = "token-del-usuario-del-sistema";
const TOKEN_PAGINA = "token-de-la-pagina-que-jamas-debe-registrarse";
const PAGE_ID = "1190035477534301";
const IG_ID = "17841403176483044";
const IMAGEN = "https://oxsqbhg0pmmalrwl.public.blob.vercel-storage.com/social/foto.jpg";

const CONFIG = { accessToken: TOKEN_SISTEMA, pageId: PAGE_ID, igUserId: IG_ID, graphVersion: "v25.0" };

type Llamada = { url: string; metodo: string; autorizacion: string };

/** Graph simulada que anota cada llamada y con que credencial se hizo. */
function espiarGraph(respuestas: Record<string, unknown>) {
  const llamadas: Llamada[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    llamadas.push({
      url,
      metodo: init?.method ?? "GET",
      autorizacion: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ""),
    });
    for (const [fragmento, cuerpo] of Object.entries(respuestas)) {
      if (url.includes(fragmento)) return new Response(JSON.stringify(cuerpo), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: "ruta no simulada", code: 100 } }), { status: 400 });
  });
  return llamadas;
}

afterEach(() => vi.restoreAllMocks());

describe("Facebook obtiene la credencial de página antes de publicar", () => {
  it("pide el token de la página y solo después publica", async () => {
    const llamadas = espiarGraph({
      "fields=access_token": { id: PAGE_ID, access_token: TOKEN_PAGINA },
      "/photos": { post_id: `${PAGE_ID}_999` },
    });

    const resultado = await new MetaAdapter("FACEBOOK", CONFIG, PAGE_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    expect(resultado.ok).toBe(true);
    expect(llamadas[0].url).toContain("fields=access_token");
    expect(llamadas[0].metodo).toBe("GET");
    expect(llamadas[1].url).toContain("/photos");
  });

  it("la llamada a /photos usa la credencial de página, no la del sistema", async () => {
    const llamadas = espiarGraph({
      "fields=access_token": { access_token: TOKEN_PAGINA },
      "/photos": { post_id: `${PAGE_ID}_999` },
    });

    await new MetaAdapter("FACEBOOK", CONFIG, PAGE_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    const publicacion = llamadas.find((llamada) => llamada.url.includes("/photos"));
    expect(publicacion?.autorizacion).toBe(`Bearer ${TOKEN_PAGINA}`);
    expect(publicacion?.autorizacion).not.toContain(TOKEN_SISTEMA);
  });

  it("las publicaciones de solo texto y de vídeo también la usan", async () => {
    for (const [ruta, respuesta, entrada] of [
      ["/feed", { id: `${PAGE_ID}_1` }, { caption: "Solo texto" }],
      ["/videos", { id: `${PAGE_ID}_2` }, { caption: "Vídeo", mediaUrl: "https://cdn.test/v.mp4" }],
    ] as const) {
      const llamadas = espiarGraph({ "fields=access_token": { access_token: TOKEN_PAGINA }, [ruta]: respuesta });
      await new MetaAdapter("FACEBOOK", CONFIG, PAGE_ID).publish(entrada);
      expect(llamadas.find((l) => l.url.includes(ruta))?.autorizacion, ruta).toBe(`Bearer ${TOKEN_PAGINA}`);
      vi.restoreAllMocks();
    }
  });
});

describe("falla cerrado si no hay credencial de página", () => {
  it("no publica con el token del sistema como respaldo", async () => {
    // Publicar igualmente seria volver al fallo que esto corrige, y ademas lo
    // dejaria enmascarado tras un rechazo de Meta mas dificil de leer.
    const llamadas = espiarGraph({ "fields=access_token": { error: { message: "sin permiso", code: 200 } } });

    const resultado = await new MetaAdapter("FACEBOOK", CONFIG, PAGE_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    expect(resultado.ok).toBe(false);
    expect(resultado.errorCode).toBe("FB_PAGE_TOKEN_UNAVAILABLE");
    expect(llamadas.some((llamada) => llamada.url.includes("/photos"))).toBe(false);
  });

  it("el mensaje es humano para Dirección y el código técnico para Vista Técnica", async () => {
    espiarGraph({ "fields=access_token": { error: { message: "sin permiso", code: 200 } } });
    const resultado = await new MetaAdapter("FACEBOOK", CONFIG, PAGE_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    expect(resultado.error).toContain("no se publicó nada");
    // Sin jerga ni nombres de credenciales en el texto que ve Dirección.
    expect(resultado.error).not.toMatch(/token|access_token|Graph|OAuth|scope/i);
    expect(resultado.errorCode).toBe("FB_PAGE_TOKEN_UNAVAILABLE");
    expect(resultado.providerResponse).toMatchObject({ step: "page_token", metaCode: 200 });
  });
});

describe("Instagram no cambia", () => {
  it("sigue publicando con el token del usuario del sistema", async () => {
    const llamadas = espiarGraph({
      "/media_publish": { id: "media-publicado" },
      "status_code": { status_code: "FINISHED" },
      "/media": { id: "contenedor" },
    });

    const resultado = await new MetaAdapter("INSTAGRAM", CONFIG, IG_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    expect(resultado.ok).toBe(true);
    for (const llamada of llamadas) {
      expect(llamada.autorizacion).toBe(`Bearer ${TOKEN_SISTEMA}`);
    }
    // Instagram no deriva credencial de pagina: no le hace falta.
    expect(llamadas.some((llamada) => llamada.url.includes("fields=access_token"))).toBe(false);
  });
});

describe("el token de página nunca se registra", () => {
  it("ningún log lo contiene, ni completo ni parcial", async () => {
    const espias = (["log", "info", "warn", "error", "debug"] as const).map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation(() => undefined),
    );
    espiarGraph({ "fields=access_token": { access_token: TOKEN_PAGINA }, "/photos": { post_id: `${PAGE_ID}_999` } });

    const resultado = await new MetaAdapter("FACEBOOK", CONFIG, PAGE_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    const escrito = espias.flatMap((espia) => espia.mock.calls.flat()).map(String).join(" ");
    expect(escrito).not.toContain(TOKEN_PAGINA);
    expect(escrito).not.toContain(TOKEN_PAGINA.slice(0, 12));
    // Tampoco puede volver en el resultado, que se guarda en la base.
    expect(JSON.stringify(resultado)).not.toContain(TOKEN_PAGINA);
    expect(JSON.stringify(resultado)).not.toContain(TOKEN_SISTEMA);
  });
});

describe("no se publica en una página distinta de la seleccionada", () => {
  it("todas las llamadas van al Page ID de la cuenta elegida", async () => {
    const OTRA_PAGINA = "999999999999999";
    const llamadas = espiarGraph({
      "fields=access_token": { access_token: TOKEN_PAGINA },
      "/photos": { post_id: `${PAGE_ID}_999` },
    });

    // La configuracion apunta a otra pagina; manda la cuenta seleccionada.
    await new MetaAdapter("FACEBOOK", { ...CONFIG, pageId: OTRA_PAGINA }, PAGE_ID).publish({ caption: "Hola", mediaUrl: IMAGEN });

    expect(llamadas.length).toBeGreaterThan(0);
    for (const llamada of llamadas) {
      expect(llamada.url, `no debe tocar ${OTRA_PAGINA}`).not.toContain(OTRA_PAGINA);
      expect(llamada.url).toContain(PAGE_ID);
    }
  });
});
