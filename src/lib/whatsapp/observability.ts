/**
 * Traza de los envios de WhatsApp.
 *
 * Cuando un envio falla en produccion no hay a quien preguntar: la unica prueba
 * de lo ocurrido es lo que quedo escrito. Sin traza, un 132000 de Meta se ve
 * desde el panel como "no entregado" y nada mas, y averiguar si fue la
 * plantilla, el numero de parametros o el token cuesta horas.
 *
 * La regla que gobierna este archivo es que NUNCA se registra un secreto ni un
 * dato personal. Y no se aplica tachando lo peligroso —eso obliga a acertar
 * cada vez que alguien añade un campo— sino al reves: se construye el registro
 * campo a campo desde una lista cerrada. Lo que no esta en `EVENTOS` no se
 * escribe, aunque venga en el objeto de origen.
 *
 * En concreto quedan fuera, siempre:
 *   - el token de acceso y el App Secret;
 *   - el identificador del numero de la empresa;
 *   - el telefono del destinatario, que es dato personal;
 *   - el cuerpo del mensaje y los valores de los parametros de la plantilla.
 *
 * El nombre de la plantilla si se registra: no identifica a nadie y es lo
 * primero que hace falta saber cuando Meta rechaza un envio.
 */

export type WhatsAppLogEvent =
  | {
      evento: "envio_aceptado";
      plantilla: string | null;
      idioma: string | null;
      /** Identificador que devuelve Meta. Sirve para cruzar con el webhook. */
      wamid: string;
      mensajeId: string;
      httpStatus: number;
    }
  | {
      evento: "envio_rechazado";
      plantilla: string | null;
      idioma: string | null;
      mensajeId: string;
      codigo: string;
      httpStatus: number | null;
      /** Codigo numerico de Graph, cuando Meta lo devuelve. */
      graphCode: number | null;
      permanente: boolean;
    }
  | {
      evento: "envio_bloqueado";
      /** Por que ni siquiera se intento: modo, credenciales, plantilla… */
      codigo: string;
      mensajeId: string;
      plantilla: string | null;
    };

/** Campos que se escriben para cada tipo de evento. Nada fuera de esta lista sale. */
const EVENTOS = {
  envio_aceptado: ["plantilla", "idioma", "wamid", "mensajeId", "httpStatus"],
  envio_rechazado: ["plantilla", "idioma", "mensajeId", "codigo", "httpStatus", "graphCode", "permanente"],
  envio_bloqueado: ["codigo", "mensajeId", "plantilla"],
} as const satisfies Record<WhatsAppLogEvent["evento"], readonly string[]>;

/**
 * Construye la linea que se va a escribir, ya filtrada.
 *
 * Se expone aparte de `logWhatsAppEvent` para poder comprobarlo en pruebas sin
 * capturar la salida del proceso: si el filtro se rompe alguna vez, conviene
 * que lo diga una prueba y no un token en los registros de Vercel.
 */
export function buildWhatsAppLogLine(event: WhatsAppLogEvent, now = new Date()): Record<string, unknown> {
  const permitidos = EVENTOS[event.evento] as readonly string[];
  const linea: Record<string, unknown> = { canal: "whatsapp", evento: event.evento, ts: now.toISOString() };
  for (const campo of permitidos) {
    const valor = (event as Record<string, unknown>)[campo];
    if (valor !== undefined) linea[campo] = valor;
  }
  return linea;
}

/**
 * Escribe el evento como JSON en una sola linea.
 *
 * Una linea por evento y JSON plano porque es lo que los registros de Vercel
 * saben agrupar y filtrar; un texto con saltos se parte en entradas sueltas y
 * deja de poder buscarse.
 */
export function logWhatsAppEvent(event: WhatsAppLogEvent, now = new Date()): void {
  const linea = buildWhatsAppLogLine(event, now);
  const salida = JSON.stringify(linea);
  if (event.evento === "envio_rechazado" || event.evento === "envio_bloqueado") {
    console.warn(salida);
  } else {
    console.info(salida);
  }
}
