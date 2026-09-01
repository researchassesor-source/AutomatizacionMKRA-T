import { describe, expect, it } from "vitest";
import { debeEjecutarCronTick, respuestaCronTickSaltado } from "./cron-cadence";

const URL_CRON = "https://crm.ra-training.com/api/cron/tick";

describe("cadencia del reloj maestro", () => {
  it("en producción ejecuta cada 15 minutos por defecto", () => {
    const env = { NODE_ENV: "production" } as const;

    expect(
      debeEjecutarCronTick({
        ahora: new Date("2026-09-01T00:15:00.000Z"),
        env,
        url: URL_CRON,
      }),
    ).toBe(true);
    expect(
      debeEjecutarCronTick({
        ahora: new Date("2026-09-01T00:16:00.000Z"),
        env,
        url: URL_CRON,
      }),
    ).toBe(false);
  });

  it("permite ajustar la cadencia por variable sin tocar código", () => {
    expect(
      debeEjecutarCronTick({
        ahora: new Date("2026-09-01T00:10:00.000Z"),
        env: { NODE_ENV: "production", CRM_CRON_MIN_INTERVAL_MINUTES: "10" },
        url: URL_CRON,
      }),
    ).toBe(true);
  });

  it("en desarrollo y pruebas no bloquea el reloj local", () => {
    expect(
      debeEjecutarCronTick({
        ahora: new Date("2026-09-01T00:16:00.000Z"),
        env: { NODE_ENV: "test" },
        url: URL_CRON,
      }),
    ).toBe(true);
  });

  it("permite ejecución manual forzada para diagnóstico autenticado", () => {
    expect(
      debeEjecutarCronTick({
        ahora: new Date("2026-09-01T00:16:00.000Z"),
        env: { NODE_ENV: "production" },
        url: `${URL_CRON}?force=1`,
      }),
    ).toBe(true);
  });

  it("la respuesta saltada no expone secretos ni dispara errores/reintentos", () => {
    expect(respuestaCronTickSaltado(new Date("2026-09-01T00:16:00.000Z"))).toMatchObject({
      ok: true,
      estado: "saltado_por_cadencia",
      ejecutadoEn: "2026-09-01T00:16:00.000Z",
    });
  });
});
