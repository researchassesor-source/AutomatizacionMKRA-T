/** Fuente de variables: `process.env` en ejecución, un objeto plano en pruebas. */
export type EnvSource = Record<string, string | undefined>;

export function isPreviewDeployment(env: EnvSource = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

/**
 * Un canal externo solo actúa de verdad en Producción y con el modo declarado
 * explícitamente como `live`. Preview y desarrollo simulan siempre.
 *
 * `env` permite evaluar la decisión sobre un entorno concreto en pruebas sin
 * depender de variables globales.
 */
export function mustSimulateExternalIntegration(mode: string | undefined, env: EnvSource = process.env): boolean {
  return isPreviewDeployment(env) || env.NODE_ENV !== "production" || mode !== "live";
}
