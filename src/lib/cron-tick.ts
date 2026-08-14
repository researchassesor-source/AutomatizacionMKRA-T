import { finalizeCompletedCourseEnrollments, processScheduledMessages } from "@/lib/nurture/engine";
import { processScheduledPosts } from "@/lib/social/orchestrator";

/**
 * Reloj maestro: un solo despertar para los dos subsistemas.
 *
 * Antes cada uno tenia su propio endpoint y hacia falta un disparador por
 * cabeza. Con un reloj externo de un minuto eso serian 2.880 mensajes al dia,
 * por encima del limite del plan contratado. Aqui se ejecutan en el mismo
 * proceso, sin que el servidor se llame a si mismo por HTTP: una peticion
 * interna añade latencia, un salto de red que puede fallar y una segunda
 * autenticacion que no aporta nada.
 *
 * No hay logica nueva. Se invocan los mismos orquestadores que usan los
 * endpoints existentes, que siguen en pie para diagnostico y compatibilidad.
 * La proteccion contra duplicados es la que ya existia: cada publicacion y
 * cada mensaje se reclaman con una escritura condicional, asi que dos relojes
 * solapados no producen envios repetidos.
 *
 * Los dos subsistemas se ejecutan de forma AISLADA. Si el de redes revienta,
 * el de comunicaciones tiene que seguir corriendo y quedar registrado: son
 * canales distintos y una averia en uno no puede silenciar al otro.
 */

export type ResultadoSubsistema =
  | { estado: "ok"; resumen: Record<string, number | boolean | string | null> }
  | { estado: "bloqueado"; errorCode: string | null; error: string | null }
  | { estado: "error"; error: string };

export type ResultadoTick = {
  ok: boolean;
  ejecutadoEn: string;
  duracionMs: number;
  social: ResultadoSubsistema;
  comunicaciones: ResultadoSubsistema;
  cierres: ResultadoSubsistema;
};

/** Un fallo inesperado no puede tumbar el reloj entero ni el otro subsistema. */
async function aislar(nombre: string, tarea: () => Promise<ResultadoSubsistema>): Promise<ResultadoSubsistema> {
  try {
    return await tarea();
  } catch (error) {
    // El mensaje del error se recorta y no se registra el objeto entero: puede
    // arrastrar el cuerpo de una peticion, y ahi viajan datos de contacto.
    const detalle = error instanceof Error ? error.message.slice(0, 200) : "fallo desconocido";
    console.error(`[cron/tick] ${nombre} falló: ${detalle}`);
    return { estado: "error", error: detalle };
  }
}

async function ejecutarSocial(ahora: Date): Promise<ResultadoSubsistema> {
  const resumen = await processScheduledPosts(ahora);
  if (resumen.blocked) {
    return { estado: "bloqueado", errorCode: resumen.errorCode ?? null, error: resumen.error ?? null };
  }
  return {
    estado: "ok",
    resumen: {
      procesadas: resumen.processed,
      recurrentesExpandidas: resumen.expanded,
      correctas: resumen.results.filter((item) => item.ok).length,
      fallidas: resumen.results.filter((item) => !item.ok).length,
    },
  };
}

async function ejecutarComunicaciones(ahora: Date): Promise<ResultadoSubsistema> {
  const resumen = await processScheduledMessages(ahora);
  if (resumen.blocked) {
    return { estado: "bloqueado", errorCode: resumen.errorCode ?? null, error: resumen.error ?? null };
  }
  return {
    estado: "ok",
    resumen: {
      procesados: resumen.processed,
      correctos: resumen.succeeded,
      fallidos: resumen.failed,
      reglasAplicadas: resumen.automations?.enqueued ?? 0,
      // Canales bloqueados por configuracion: no es un fallo del reloj, pero
      // conviene verlo desde la respuesta sin abrir el panel.
      canalesBloqueados: resumen.blockedChannels.map((canal) => canal.channel).join(", ") || "ninguno",
    },
  };
}

/**
 * Cierre de inscripciones cuyo curso ya termino.
 *
 * `finalizeCompletedCourseEnrollments` existia, estaba exportada y NO la
 * llamaba nadie. Por eso ningun curso se cerraba nunca y sus avisos pendientes
 * se quedaban en la cola para siempre: 37 bienvenidas de agosto seguian
 * ofreciendose como "listo para enviar" despues de que el curso acabara.
 *
 * Marca COMPLETADO solo cuando ya no queda ninguna comunicacion futura valida,
 * de modo que los avisos posteriores al curso —curso completo, seguimiento y
 * encuesta— salen antes de cerrar.
 */
async function ejecutarCierres(ahora: Date): Promise<ResultadoSubsistema> {
  const resumen = await finalizeCompletedCourseEnrollments(ahora);
  return {
    estado: "ok",
    resumen: {
      inscripcionesCerradas: resumen.completed,
      avisosCancelados: resumen.cancelled,
    },
  };
}

/**
 * Ejecuta los subsistemas y devuelve que paso en cada uno.
 *
 * `ok` es cierto solo si ninguno lanzo una excepcion. Un subsistema bloqueado
 * por configuracion NO es un fallo del reloj: el reloj hizo su trabajo y el
 * canal decidio no enviar, que es justo lo que debe pasar en simulacion.
 */
export async function ejecutarTick(ahora = new Date()): Promise<ResultadoTick> {
  const inicio = Date.now();
  // En paralelo y aislados: ninguno espera al otro ni puede tumbarlo.
  // Los cierres van ANTES de despachar: si el curso ya termino, sus avisos
  // pendientes se cancelan y el despacho de este mismo tick ya no los ve.
  const cierres = await aislar("cierres", () => ejecutarCierres(ahora));
  const [social, comunicaciones] = await Promise.all([
    aislar("social", () => ejecutarSocial(ahora)),
    aislar("comunicaciones", () => ejecutarComunicaciones(ahora)),
  ]);

  return {
    ok: social.estado !== "error" && comunicaciones.estado !== "error" && cierres.estado !== "error",
    ejecutadoEn: ahora.toISOString(),
    duracionMs: Date.now() - inicio,
    social,
    comunicaciones,
    cierres,
  };
}
