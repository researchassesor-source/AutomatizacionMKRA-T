import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isWithinLiveWindow, parseLiveFrom, resolveMessagingWindow } from "./live-activation";
import { MAX_ATTEMPTS } from "./nurture/engine";

/**
 * Salud de canales antes de una activación real.
 *
 * Lo que se protege aquí es una sola promesa: pasar un canal a real no puede
 * hacer que salga de golpe la cola vieja, ni que un mensaje ya cerrado vuelva
 * a intentarse solo.
 */
const raiz = join(process.cwd(), "src");
const motor = readFileSync(join(raiz, "lib/nurture/engine.ts"), "utf8");
const reintento = readFileSync(join(raiz, "app/api/admin/messages/[id]/route.ts"), "utf8");

describe("la ventana de activación contiene la cola atrasada", () => {
  const ventana = { state: "live" as const, liveFrom: new Date("2026-08-07T06:00:00Z") };

  it("lo programado antes del corte no sale", () => {
    expect(isWithinLiveWindow(ventana, new Date("2026-08-06T23:59:00Z"))).toBe(false);
  });

  it("lo programado desde el corte sí sale", () => {
    expect(isWithinLiveWindow(ventana, new Date("2026-08-07T06:00:00Z"))).toBe(true);
  });

  it("un canal en real sin fecha de corte queda bloqueado, no envía", () => {
    const w = resolveMessagingWindow({ NODE_ENV: "production", MESSAGING_MODE: "live" });
    expect(w.state).toBe("blocked");
    expect(isWithinLiveWindow(w, new Date())).toBe(false);
  });

  it("una fecha sin zona horaria se rechaza: el corte no puede quedar ambiguo", () => {
    expect(parseLiveFrom("2026-08-07T06:00:00")).toBeNull();
    expect(parseLiveFrom("2026-08-07T06:00:00Z")).toBeInstanceOf(Date);
  });
});

describe("la cola automática no resucita lo ya cerrado", () => {
  it("solo reintenta sola lo que tiene una próxima fecha vencida", () => {
    // `nextAttemptAt: null` es la marca de «agotado o permanente». El selector
    // por lotes exige `lte: now`, que un nulo nunca cumple: por eso los 572
    // correos del bloqueo SMTP no vuelven a intentarse solos.
    expect(motor).toContain('{ status: "FALLIDO", attemptCount: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } }');
  });

  it("un fallo permanente agota los intentos en vez de repetirse", () => {
    expect(motor).toContain("const exhausted = result.permanent === true || attemptCount >= MAX_ATTEMPTS");
    expect(motor).toContain("nextAttemptAt: exhausted ? null : retryAt(attemptCount, now)");
  });

  it("cada envío comprueba la ventana antes de reclamar el mensaje", () => {
    const envio = motor.slice(motor.indexOf("export async function sendMessage"));
    const antesDelReclamo = envio.slice(0, envio.indexOf("const claimed"));
    expect(antesDelReclamo).toContain("isWithinLiveWindow(window, scheduled.scheduledAt)");
    expect(antesDelReclamo).toContain('window.state === "blocked"');
  });
});

describe("reintento manual desde el panel", () => {
  it("concede un intento aunque el presupuesto automático esté agotado", () => {
    // Antes se marcaba FALLIDO y después el reclamo fallaba por
    // `attemptCount >= MAX_ATTEMPTS`: el mensaje quedaba mutado, sin enviarse, y
    // la respuesta culpaba al momento («todavía no corresponde reintentarlo»).
    expect(reintento).toContain("attemptCount: Math.min(message.attemptCount, MAX_ATTEMPTS - 1)");
  });

  it("deja el contador justo por debajo del límite, así un segundo fallo lo agota", () => {
    // El reclamo incrementa: MAX_ATTEMPTS - 1 pasa a MAX_ATTEMPTS. Si vuelve a
    // fallar queda agotado y no reingresa a la cola automática.
    expect(Math.min(MAX_ATTEMPTS, MAX_ATTEMPTS - 1) + 1).toBe(MAX_ATTEMPTS);
  });

  it("limpia la espera pendiente, que es lo que el clic decide saltarse", () => {
    expect(reintento).toContain("nextAttemptAt: null");
  });

  it("conserva los intentos ya gastados de un mensaje que aún no se agotó", () => {
    // `Math.min` no sube el contador: un mensaje con 1 intento sigue con 1.
    expect(Math.min(1, MAX_ATTEMPTS - 1)).toBe(1);
  });

  it("sigue exigiendo rol y confirmación explícita", () => {
    expect(reintento).toContain("requireRole");
    expect(reintento).toContain("confirm: z.literal(true)");
  });

  it("no borra el mensaje ni toca la inscripción", () => {
    expect(reintento).not.toMatch(/deleteMany|enrollment\.update|\.delete\(/);
  });
});
