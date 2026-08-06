import { mustSimulateExternalIntegration } from "@/lib/runtime-environment";

/**
 * Ventana de activación real de cada canal externo.
 *
 * Los procesadores seleccionan lo vencido (`scheduledAt <= ahora`), así que al
 * pasar un canal a `live` toda la cola atrasada saldría de golpe. Depender de
 * revisarla a mano antes de cada activación es frágil: basta olvidarlo una vez.
 *
 * Por eso activar un canal exige además una fecha de corte explícita. Nada
 * programado antes de esa fecha puede salir automáticamente, sin importar
 * cuántas veces corra el reloj. Los registros antiguos siguen visibles y
 * cancelables desde el panel; simplemente dejan de ser candidatos a envío.
 *
 * Sin la fecha de corte, un canal en `live` queda bloqueado: falla de forma
 * segura en lugar de enviar.
 */
export type LiveWindow =
  | { state: "simulation" }
  | { state: "live"; liveFrom: Date }
  | { state: "blocked"; errorCode: string; error: string };

export const MESSAGING_LIVE_FROM = "MESSAGING_LIVE_FROM";
export const SOCIAL_LIVE_FROM = "SOCIAL_LIVE_FROM";

export type EnvSource = Record<string, string | undefined>;

/**
 * Solo se acepta ISO 8601 en UTC con `Z` explícita. Una fecha sin zona horaria
 * se interpretaría distinto según el servidor y la fecha de corte es
 * precisamente lo que no puede quedar ambiguo.
 */
export function parseLiveFrom(raw: string | undefined): Date | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveWindow(env: EnvSource, mode: string | undefined, variable: string, raw: string | undefined): LiveWindow {
  if (mustSimulateExternalIntegration(mode, env)) return { state: "simulation" };
  const liveFrom = parseLiveFrom(raw);
  if (!liveFrom) {
    return {
      state: "blocked",
      errorCode: raw?.trim() ? "LIVE_FROM_INVALID" : "LIVE_FROM_MISSING",
      error: raw?.trim()
        ? `${variable} no es una fecha ISO 8601 en UTC (ejemplo: 2026-08-06T18:00:00Z). El envío real queda bloqueado por seguridad.`
        : `Falta ${variable}. Para activar el modo real hay que declarar desde qué momento puede salir contenido; así la cola atrasada nunca se dispara sola.`,
    };
  }
  return { state: "live", liveFrom };
}

export function resolveMessagingWindow(env: EnvSource = process.env): LiveWindow {
  return resolveWindow(env, env.MESSAGING_MODE, MESSAGING_LIVE_FROM, env[MESSAGING_LIVE_FROM]);
}

export function resolveSocialWindow(env: EnvSource = process.env): LiveWindow {
  return resolveWindow(env, env.SOCIAL_MODE, SOCIAL_LIVE_FROM, env[SOCIAL_LIVE_FROM]);
}

/**
 * ¿Este elemento puede salir? En simulación sí (no se contacta a nadie). En
 * live, solo si se programó a partir de la fecha de corte.
 */
export function isWithinLiveWindow(window: LiveWindow, scheduledAt: Date | null | undefined): boolean {
  if (window.state === "blocked") return false;
  if (window.state === "simulation") return true;
  if (!scheduledAt) return false;
  return scheduledAt.getTime() >= window.liveFrom.getTime();
}

/** Motivo legible cuando un elemento queda fuera de la ventana. */
export function outsideLiveWindowMessage(window: LiveWindow, variable: string): string {
  if (window.state !== "live") return "El canal no está activo.";
  return `Se programó antes de la fecha de activación (${variable}=${window.liveFrom.toISOString()}). Revísalo y cancélalo o reprográmalo desde el panel; no saldrá de forma automática.`;
}

/** Resumen para la interfaz. No expone ninguna credencial. */
export function describeLiveWindow(window: LiveWindow) {
  return {
    state: window.state,
    liveFrom: window.state === "live" ? window.liveFrom.toISOString() : null,
    errorCode: window.state === "blocked" ? window.errorCode : null,
    error: window.state === "blocked" ? window.error : null,
  };
}
