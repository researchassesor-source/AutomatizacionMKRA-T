import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeLiveWindow,
  isWithinLiveWindow,
  parseLiveFrom,
  resolveMessagingWindow,
  resolveSocialWindow,
  type LiveWindow,
} from "./live-activation";

afterEach(() => vi.unstubAllEnvs());

/** Entorno equivalente a Producción, donde `live` sí habilita el envío real. */
function productionEnv(extra: Record<string, string | undefined> = {}) {
  return { NODE_ENV: "production", VERCEL_ENV: "production", ...extra } as Record<string, string | undefined>;
}

describe("lectura de la fecha de activación", () => {
  it("acepta ISO 8601 en UTC", () => {
    expect(parseLiveFrom("2026-08-06T18:00:00Z")?.toISOString()).toBe("2026-08-06T18:00:00.000Z");
    expect(parseLiveFrom("2026-08-06T18:00Z")?.toISOString()).toBe("2026-08-06T18:00:00.000Z");
    expect(parseLiveFrom("2026-08-06T18:00:00.500Z")?.toISOString()).toBe("2026-08-06T18:00:00.500Z");
  });

  it("rechaza fechas sin zona horaria explícita", () => {
    // Sin `Z` el servidor la interpretaría en su zona local: justo lo que no
    // puede quedar ambiguo en una fecha de corte.
    expect(parseLiveFrom("2026-08-06T18:00:00")).toBeNull();
    expect(parseLiveFrom("2026-08-06T18:00:00-05:00")).toBeNull();
  });

  it("rechaza valores inválidos, vacíos o ausentes", () => {
    for (const value of [undefined, "", "   ", "ayer", "2026-13-45T99:99:99Z", "1754503200"]) {
      expect(parseLiveFrom(value)).toBeNull();
    }
  });
});

describe("ventana de mensajería", () => {
  it("en simulación no exige la fecha de activación", () => {
    const window = resolveMessagingWindow({ NODE_ENV: "production", VERCEL_ENV: "production", MESSAGING_MODE: "simulation" });
    expect(window.state).toBe("simulation");
    expect(isWithinLiveWindow(window, new Date("2020-01-01T00:00:00Z"))).toBe(true);
  });

  it("fuera de Producción sigue en simulación aunque el modo diga live", () => {
    expect(resolveMessagingWindow({ NODE_ENV: "development", MESSAGING_MODE: "live" }).state).toBe("simulation");
  });

  it("bloquea live sin fecha de activación", () => {
    const window = resolveMessagingWindow(productionEnv({ MESSAGING_MODE: "live" }));
    expect(window).toMatchObject({ state: "blocked", errorCode: "LIVE_FROM_MISSING" });
    expect(isWithinLiveWindow(window, new Date())).toBe(false);
  });

  it("bloquea live con fecha inválida", () => {
    const window = resolveMessagingWindow(productionEnv({ MESSAGING_MODE: "live", MESSAGING_LIVE_FROM: "el lunes" }));
    expect(window).toMatchObject({ state: "blocked", errorCode: "LIVE_FROM_INVALID" });
    expect(isWithinLiveWindow(window, new Date())).toBe(false);
  });

  it("habilita live con fecha válida", () => {
    const window = resolveMessagingWindow(productionEnv({ MESSAGING_MODE: "live", MESSAGING_LIVE_FROM: "2026-08-06T18:00:00Z" }));
    expect(window).toMatchObject({ state: "live" });
  });

  it("deja fuera lo programado antes del corte y deja pasar lo posterior", () => {
    const window = resolveMessagingWindow(productionEnv({ MESSAGING_MODE: "live", MESSAGING_LIVE_FROM: "2026-08-06T18:00:00Z" }));
    expect(isWithinLiveWindow(window, new Date("2026-07-01T10:00:00Z"))).toBe(false);
    expect(isWithinLiveWindow(window, new Date("2026-08-06T17:59:59Z"))).toBe(false);
    expect(isWithinLiveWindow(window, new Date("2026-08-06T18:00:00Z"))).toBe(true);
    expect(isWithinLiveWindow(window, new Date("2026-09-01T10:00:00Z"))).toBe(true);
  });

  it("un elemento sin fecha programada no pasa la ventana en live", () => {
    const window = resolveMessagingWindow(productionEnv({ MESSAGING_MODE: "live", MESSAGING_LIVE_FROM: "2026-08-06T18:00:00Z" }));
    expect(isWithinLiveWindow(window, null)).toBe(false);
  });
});

describe("ventana de redes sociales", () => {
  it("es independiente de la de mensajería", () => {
    const env = productionEnv({
      MESSAGING_MODE: "live",
      MESSAGING_LIVE_FROM: "2026-08-06T18:00:00Z",
      SOCIAL_MODE: "live",
    });
    expect(resolveMessagingWindow(env).state).toBe("live");
    expect(resolveSocialWindow(env)).toMatchObject({ state: "blocked", errorCode: "LIVE_FROM_MISSING" });
  });

  it("usa su propia fecha de corte", () => {
    const window = resolveSocialWindow(productionEnv({ SOCIAL_MODE: "live", SOCIAL_LIVE_FROM: "2026-09-01T00:00:00Z" }));
    expect(window).toMatchObject({ state: "live" });
    expect(isWithinLiveWindow(window, new Date("2026-08-15T00:00:00Z"))).toBe(false);
    expect(isWithinLiveWindow(window, new Date("2026-09-02T00:00:00Z"))).toBe(true);
  });
});

describe("resumen para la interfaz", () => {
  it("no expone nada más que el estado y la fecha", () => {
    const blocked = describeLiveWindow({ state: "blocked", errorCode: "LIVE_FROM_MISSING", error: "falta" } as LiveWindow);
    expect(blocked).toEqual({ state: "blocked", liveFrom: null, errorCode: "LIVE_FROM_MISSING", error: "falta" });
    const live = describeLiveWindow({ state: "live", liveFrom: new Date("2026-08-06T18:00:00Z") });
    expect(live).toEqual({ state: "live", liveFrom: "2026-08-06T18:00:00.000Z", errorCode: null, error: null });
  });
});
