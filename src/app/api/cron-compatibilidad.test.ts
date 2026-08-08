import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El reloj actual no puede dejar de funcionar al desplegar esto.
 *
 * `.github/workflows/automation-cron.yml` llama a los dos endpoints con
 * `curl -X GET` y `Authorization: Bearer <CRON_SECRET>`, y seguira siendo el
 * unico reloj hasta que QStash este probado. Aceptar la firma de QStash es una
 * suma, no un reemplazo: si estas pruebas fallan, el despliegue deja al CRM sin
 * publicaciones programadas y sin recordatorios, que es exactamente el fallo
 * que la migracion pretende evitar.
 *
 * Se ejercitan los handlers reales, no la funcion de autenticacion por
 * separado: lo que importa es que la ruta responda, no que una pieza suelta
 * devuelva true.
 */

const SECRETO = "secreto-de-cron-de-prueba";

vi.mock("@/lib/social/orchestrator", () => ({
  processScheduledPosts: vi.fn(async () => ({ blocked: false, processed: 0, expanded: 0, results: [] })),
  publishPost: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/nurture/engine", () => ({
  processScheduledMessages: vi.fn(async () => ({ blocked: false, processed: 0, succeeded: 0, failed: 0, results: [] })),
}));

const entornoOriginal = { ...process.env };
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  // El escenario real de HOY: hay CRON_SECRET y NO hay claves de QStash.
  process.env.CRON_SECRET = SECRETO;
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
});
afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...entornoOriginal };
});

/** Igual que el `curl -X GET` del workflow. */
function comoGitHubActions(ruta: string): Request {
  return new Request(`https://ejemplo.test${ruta}`, {
    method: "GET",
    headers: { authorization: `Bearer ${SECRETO}`, "x-crm-cron-contract": "2026-08-v2" },
  });
}

describe("GitHub Actions sigue funcionando sin claves de QStash", () => {
  it("/api/social/publish responde al GET con bearer", async () => {
    const { GET } = await import("./social/publish/route");
    const respuesta = await GET(comoGitHubActions("/api/social/publish"));
    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({ blocked: false });
  });

  it("/api/nurture/dispatch responde al GET con bearer", async () => {
    const { GET } = await import("./nurture/dispatch/route");
    const respuesta = await GET(comoGitHubActions("/api/nurture/dispatch"));
    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({ blocked: false });
  });

  it("las dos rutas conservan su handler GET además del POST", async () => {
    // Convertirlas en solo-POST habria dejado al workflow recibiendo 405 sin
    // que ninguna prueba lo notara.
    const social = await import("./social/publish/route");
    const nurture = await import("./nurture/dispatch/route");
    for (const modulo of [social, nurture]) {
      expect(typeof modulo.GET).toBe("function");
      expect(typeof modulo.POST).toBe("function");
    }
  });

  it("el POST manual también sigue aceptando el bearer", async () => {
    const { POST } = await import("./social/publish/route");
    const respuesta = await POST(
      new Request("https://ejemplo.test/api/social/publish", {
        method: "POST",
        headers: { authorization: `Bearer ${SECRETO}` },
      }),
    );
    expect(respuesta.status).toBe(200);
  });
});

describe("sin claves de firma, QStash falla cerrado y no estorba al cron actual", () => {
  it("una petición con firma de QStash se rechaza si no hay claves", async () => {
    const { POST } = await import("./social/publish/route");
    const respuesta = await POST(
      new Request("https://ejemplo.test/api/social/publish", {
        method: "POST",
        headers: { "upstash-signature": "cabecera.cuerpo.firma-inventada" },
        body: "{}",
      }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("ese rechazo no afecta a la petición legítima de GitHub Actions", async () => {
    const { GET } = await import("./social/publish/route");
    const respuesta = await GET(comoGitHubActions("/api/social/publish"));
    expect(respuesta.status).toBe(200);
  });

  it("una petición sin ninguna credencial se rechaza", async () => {
    const { GET } = await import("./nurture/dispatch/route");
    const respuesta = await GET(new Request("https://ejemplo.test/api/nurture/dispatch", { method: "GET" }));
    expect(respuesta.status).toBe(401);
  });

  it("un bearer equivocado se rechaza", async () => {
    const { GET } = await import("./social/publish/route");
    const respuesta = await GET(
      new Request("https://ejemplo.test/api/social/publish", {
        method: "GET",
        headers: { authorization: "Bearer secreto-que-no-es" },
      }),
    );
    expect(respuesta.status).toBe(401);
  });
});
