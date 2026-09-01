const INTERVALO_PRODUCCION_POR_DEFECTO = 15;

type EntornoCadencia = Partial<Pick<NodeJS.ProcessEnv, "CRM_CRON_MIN_INTERVAL_MINUTES" | "NODE_ENV">>;

function leerIntervalo(env: EntornoCadencia): number {
  if (env.NODE_ENV !== "production") {
    return 1;
  }

  const valor = env.CRM_CRON_MIN_INTERVAL_MINUTES?.trim();
  if (!valor) {
    return INTERVALO_PRODUCCION_POR_DEFECTO;
  }

  const numero = Number.parseInt(valor, 10);
  if (!Number.isFinite(numero) || numero < 1) {
    return INTERVALO_PRODUCCION_POR_DEFECTO;
  }

  return numero;
}

export function debeEjecutarCronTick({
  ahora = new Date(),
  env = process.env,
  url,
}: {
  ahora?: Date;
  env?: EntornoCadencia;
  url: string;
}): boolean {
  const requestUrl = new URL(url);
  if (requestUrl.searchParams.get("force") === "1" || requestUrl.searchParams.get("force") === "true") {
    return true;
  }

  const intervaloMinutos = leerIntervalo(env);
  if (intervaloMinutos <= 1) {
    return true;
  }

  const minutosDesdeEpoch = Math.floor(ahora.getTime() / 60_000);
  return minutosDesdeEpoch % intervaloMinutos === 0;
}

export function respuestaCronTickSaltado(ahora = new Date()) {
  return {
    ok: true,
    estado: "saltado_por_cadencia",
    ejecutadoEn: ahora.toISOString(),
    mensaje:
      "Tick autenticado omitido para ahorrar Neon Free; el siguiente minuto de cadencia ejecutara el trabajo real.",
  };
}
