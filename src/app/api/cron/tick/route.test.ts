import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRETO = "secreto-de-cron-de-prueba";

const ejecutarTick = vi.fn(async () => ({ ok: true, estado: "ejecutado" }));

vi.mock("@/lib/cron-tick", () => ({
  ejecutarTick,
}));

const entornoOriginal = { ...process.env };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CRON_SECRET", SECRETO);
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
  delete process.env.CRM_CRON_MIN_INTERVAL_MINUTES;
  ejecutarTick.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  process.env = { ...entornoOriginal };
});

function request(minuto: string) {
  vi.setSystemTime(new Date(`2026-09-01T00:${minuto}:00.000Z`));
  return new Request("https://crm.ra-training.com/api/cron/tick", {
    method: "GET",
    headers: { authorization: `Bearer ${SECRETO}` },
  });
}

describe("/api/cron/tick con ahorro Neon Free", () => {
  it("salta ticks intermedios con 200 para que QStash no reintente", async () => {
    const { GET } = await import("./route");
    const respuesta = await GET(request("16"));

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({ ok: true, estado: "saltado_por_cadencia" });
    expect(ejecutarTick).not.toHaveBeenCalled();
  });

  it("ejecuta el trabajo real en el minuto de cadencia", async () => {
    const { GET } = await import("./route");
    const respuesta = await GET(request("15"));

    expect(respuesta.status).toBe(200);
    await expect(respuesta.json()).resolves.toMatchObject({ ok: true, estado: "ejecutado" });
    expect(ejecutarTick).toHaveBeenCalledTimes(1);
  });
});
