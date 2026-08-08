import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reloj maestro: un solo despertar para los dos subsistemas.
 *
 * Lo que se comprueba aqui es que el reloj no puede convertirse en un punto
 * unico de fallo. Si el subsistema de redes revienta, el de comunicaciones
 * tiene que haber corrido igualmente y quedar registrado; son canales
 * distintos y una averia en uno no puede silenciar al otro.
 */

const SECRETO = "secreto-de-cron-de-prueba";
const CLAVE_FIRMA = "clave-de-firma-de-prueba";

const procesarPublicaciones = vi.fn();
const procesarComunicaciones = vi.fn();

vi.mock("@/lib/social/orchestrator", () => ({
  processScheduledPosts: (...args: unknown[]) => procesarPublicaciones(...args),
  publishPost: vi.fn(),
}));
vi.mock("@/lib/nurture/engine", () => ({
  processScheduledMessages: (...args: unknown[]) => procesarComunicaciones(...args),
}));

const SOCIAL_VACIO = { blocked: false, errorCode: null, error: null, expanded: 0, processed: 0, results: [] };
const NURTURE_VACIO = { blocked: false, errorCode: null, error: null, automations: null, processed: 0, succeeded: 0, failed: 0, results: [], blockedChannels: [] };

function firmar(cuerpo: string, clave = CLAVE_FIRMA): string {
  const cabecera = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "Upstash",
      exp: Math.floor(Date.now() / 1000) + 300,
      body: createHash("sha256").update(cuerpo).digest("base64url"),
    }),
  ).toString("base64url");
  const firma = createHmac("sha256", clave).update(`${cabecera}.${payload}`).digest("base64url");
  return `${cabecera}.${payload}.${firma}`;
}

const entornoOriginal = { ...process.env };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  process.env.CRON_SECRET = SECRETO;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
  procesarPublicaciones.mockReset().mockResolvedValue(SOCIAL_VACIO);
  procesarComunicaciones.mockReset().mockResolvedValue(NURTURE_VACIO);
});
afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...entornoOriginal };
});

function conBearer(): Request {
  return new Request("https://ejemplo.test/api/cron/tick", { method: "GET", headers: { authorization: `Bearer ${SECRETO}` } });
}

describe("autenticación del reloj maestro", () => {
  it("acepta una firma válida de QStash", async () => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = CLAVE_FIRMA;
    const { POST } = await import("./tick/route");
    const cuerpo = "{}";
    const respuesta = await POST(
      new Request("https://ejemplo.test/api/cron/tick", { method: "POST", headers: { "upstash-signature": firmar(cuerpo) }, body: cuerpo }),
    );
    expect(respuesta.status).toBe(200);
  });

  it("CRON_SECRET sigue funcionando durante la migración", async () => {
    // Los dos relojes conviven hasta que QStash quede demostrado.
    const { GET } = await import("./tick/route");
    expect((await GET(conBearer())).status).toBe(200);
  });

  it("rechaza sin credenciales y con un bearer equivocado", async () => {
    const { GET } = await import("./tick/route");
    expect((await GET(new Request("https://ejemplo.test/api/cron/tick"))).status).toBe(401);
    const malo = new Request("https://ejemplo.test/api/cron/tick", { headers: { authorization: "Bearer otro" } });
    expect((await GET(malo)).status).toBe(401);
  });

  it("una petición rechazada no ejecuta ningún subsistema", async () => {
    const { GET } = await import("./tick/route");
    await GET(new Request("https://ejemplo.test/api/cron/tick"));
    expect(procesarPublicaciones).not.toHaveBeenCalled();
    expect(procesarComunicaciones).not.toHaveBeenCalled();
  });
});

describe("ejecución de los dos subsistemas", () => {
  it("sin nada pendiente informa de cero en ambos", async () => {
    const { GET } = await import("./tick/route");
    const cuerpo = await (await GET(conBearer())).json();

    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.social).toMatchObject({ estado: "ok", resumen: { procesadas: 0 } });
    expect(cuerpo.comunicaciones).toMatchObject({ estado: "ok", resumen: { procesados: 0 } });
  });

  it("informa de las publicaciones sociales procesadas", async () => {
    procesarPublicaciones.mockResolvedValue({
      ...SOCIAL_VACIO,
      processed: 2,
      expanded: 1,
      results: [{ id: "a", ok: true }, { id: "b", ok: false }],
    });
    const { GET } = await import("./tick/route");
    const cuerpo = await (await GET(conBearer())).json();

    expect(cuerpo.social.resumen).toMatchObject({ procesadas: 2, correctas: 1, fallidas: 1, recurrentesExpandidas: 1 });
  });

  it("informa de las comunicaciones procesadas", async () => {
    procesarComunicaciones.mockResolvedValue({
      ...NURTURE_VACIO,
      processed: 5,
      succeeded: 4,
      failed: 1,
      automations: { enqueued: 3 },
      blockedChannels: [{ channel: "WHATSAPP" }],
    });
    const { GET } = await import("./tick/route");
    const cuerpo = await (await GET(conBearer())).json();

    expect(cuerpo.comunicaciones.resumen).toMatchObject({ procesados: 5, correctos: 4, fallidos: 1, reglasAplicadas: 3, canalesBloqueados: "WHATSAPP" });
  });

  it("un canal bloqueado por configuración no es un fallo del reloj", async () => {
    procesarComunicaciones.mockResolvedValue({ ...NURTURE_VACIO, blocked: true, errorCode: "WHATSAPP_DISABLED", error: "Canal apagado." });
    const { GET } = await import("./tick/route");
    const cuerpo = await (await GET(conBearer())).json();

    expect(cuerpo.comunicaciones).toMatchObject({ estado: "bloqueado", errorCode: "WHATSAPP_DISABLED" });
    // El reloj hizo su trabajo: el canal decidió no enviar, que es lo correcto.
    expect(cuerpo.ok).toBe(true);
  });
});

describe("un subsistema no puede tumbar al otro", () => {
  it("si redes revienta, las comunicaciones se ejecutan igualmente", async () => {
    procesarPublicaciones.mockRejectedValue(new Error("Graph no responde"));
    procesarComunicaciones.mockResolvedValue({ ...NURTURE_VACIO, processed: 3, succeeded: 3 });
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("./tick/route");
    const respuesta = await GET(conBearer());
    const cuerpo = await respuesta.json();

    // 200 a propósito: un 500 haría que QStash reintentara el tick entero,
    // incluida la parte que sí funcionó.
    expect(respuesta.status).toBe(200);
    expect(cuerpo.ok).toBe(false);
    expect(cuerpo.social).toMatchObject({ estado: "error", error: "Graph no responde" });
    expect(cuerpo.comunicaciones).toMatchObject({ estado: "ok", resumen: { procesados: 3 } });
    expect(procesarComunicaciones).toHaveBeenCalledTimes(1);
    errores.mockRestore();
  });

  it("si las comunicaciones revientan, redes se ejecuta igualmente", async () => {
    procesarComunicaciones.mockRejectedValue(new Error("base de datos caída"));
    procesarPublicaciones.mockResolvedValue({ ...SOCIAL_VACIO, processed: 1, results: [{ id: "a", ok: true }] });
    const errores = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { GET } = await import("./tick/route");
    const cuerpo = await (await GET(conBearer())).json();

    expect(cuerpo.social).toMatchObject({ estado: "ok", resumen: { procesadas: 1 } });
    expect(cuerpo.comunicaciones).toMatchObject({ estado: "error" });
    errores.mockRestore();
  });
});

describe("idempotencia", () => {
  it("dos invocaciones seguidas no duplican nada", async () => {
    // La proteccion vive en los orquestadores: cada publicacion y cada mensaje
    // se reclaman con una escritura condicional. El reloj solo despierta, asi
    // que la segunda vuelta encuentra la cola ya vacia.
    procesarPublicaciones
      .mockResolvedValueOnce({ ...SOCIAL_VACIO, processed: 2, results: [{ id: "a", ok: true }, { id: "b", ok: true }] })
      .mockResolvedValueOnce(SOCIAL_VACIO);
    procesarComunicaciones
      .mockResolvedValueOnce({ ...NURTURE_VACIO, processed: 4, succeeded: 4 })
      .mockResolvedValueOnce(NURTURE_VACIO);

    const { GET } = await import("./tick/route");
    const primera = await (await GET(conBearer())).json();
    const segunda = await (await GET(conBearer())).json();

    expect(primera.social.resumen.procesadas).toBe(2);
    expect(primera.comunicaciones.resumen.procesados).toBe(4);
    expect(segunda.social.resumen.procesadas).toBe(0);
    expect(segunda.comunicaciones.resumen.procesados).toBe(0);
  });

  it("el reloj no publica por su cuenta: delega en los orquestadores", async () => {
    // Duplicar la logica aqui abriria la puerta a que las dos rutas
    // divergieran, y con ellas las protecciones contra duplicados.
    const { GET } = await import("./tick/route");
    await GET(conBearer());
    expect(procesarPublicaciones).toHaveBeenCalledTimes(1);
    expect(procesarComunicaciones).toHaveBeenCalledTimes(1);
  });
});

describe("la respuesta no filtra datos sensibles", () => {
  it("no incluye destinatarios, contenidos ni credenciales", async () => {
    procesarComunicaciones.mockResolvedValue({
      ...NURTURE_VACIO,
      processed: 1,
      succeeded: 1,
      results: [{ id: "msg", ok: true, toAddress: "persona@ejemplo.com", body: "Hola Angel" }],
    });
    const { GET } = await import("./tick/route");
    const cuerpo = JSON.stringify(await (await GET(conBearer())).json());

    expect(cuerpo).not.toContain("persona@ejemplo.com");
    expect(cuerpo).not.toContain("Hola Angel");
    expect(cuerpo).not.toContain(SECRETO);
  });
});
