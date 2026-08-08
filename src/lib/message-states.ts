import type { MessageStatus, Prisma } from "@prisma/client";

/**
 * Los estados que ve Dirección, y la única definición de cada uno.
 *
 * El problema que resuelve este archivo es de confianza, no de estética. La
 * pantalla de comunicaciones enseña contadores ("3 requieren configuración") y
 * al lado un filtro que promete enseñar justo esos. Cuando el contador y el
 * filtro se escriben por separado —uno como `count` con su `where` y el otro
 * como `findMany` con otro— acaban divergiendo en cuanto alguien toca uno de
 * los dos. Un contador que dice 3 y una lista que enseña 5 destruye la
 * credibilidad de toda la pantalla, incluida la parte que sí era correcta.
 *
 * Aquí cada estado se define UNA vez, como una lista de condiciones sobre el
 * estado interno y sobre si al mensaje ya le tocaba salir. De esa definición
 * salen las dos cosas: la consulta que cuenta y filtra (`filtroDe`) y la
 * clasificación en memoria de una fila concreta (`estadoVisibleDe`). No pueden
 * discrepar porque son la misma definición leída de dos maneras.
 *
 * Los once estados internos siguen existiendo en la base: el sistema los
 * necesita para decidir qué hacer. Esta es la traducción, no un reemplazo.
 */

/** ¿Importa si al mensaje ya le tocaba salir? */
type Momento = "cualquiera" | "vencido" | "futuro";

type Condicion = { estados: MessageStatus[]; momento: Momento };

export type EstadoVisibleKey =
  | "programado"
  | "listo"
  | "requiere_config"
  | "enviado"
  | "entregado"
  | "leido"
  | "no_entregado"
  | "cancelado"
  | "prueba";

/** Tono visual. Es el mismo vocabulario que usa el punto de color de la tabla. */
export type EstadoTono = "waiting" | "blocked" | "sent" | "done" | "problem" | "test";

export type EstadoVisible = {
  key: EstadoVisibleKey;
  label: string;
  tono: EstadoTono;
  /** Explicación corta, sin códigos ni vocabulario del sistema. */
  hint: string;
  condiciones: Condicion[];
};

export const ESTADOS_VISIBLES: readonly EstadoVisible[] = [
  {
    key: "programado",
    label: "Programado",
    tono: "waiting",
    hint: "Todavía no le toca salir; saldrá a la hora prevista.",
    condiciones: [{ estados: ["PROGRAMADO"], momento: "futuro" }],
  },
  {
    // Separado de "Programado" a propósito: un mensaje cuya hora ya pasó y
    // sigue en cola no es lo mismo que uno que espera su turno. Si esta cifra
    // crece sola, es que el envío automático dejó de ejecutarse, y esa es
    // exactamente la avería que conviene ver desde la primera pantalla.
    key: "listo",
    label: "Listo para enviar",
    tono: "waiting",
    hint: "Su hora ya llegó y está en cola para salir.",
    condiciones: [{ estados: ["PROGRAMADO"], momento: "vencido" }],
  },
  {
    key: "requiere_config",
    label: "Requiere configuración",
    tono: "blocked",
    hint: "Todavía no le toca salir, pero falta un dato para poder prepararlo.",
    condiciones: [{ estados: ["OMITIDO"], momento: "futuro" }],
  },
  {
    // ENVIANDO, ACEPTADO y ENVIADO son tres momentos internos del mismo hecho:
    // el mensaje salió. Distinguirlos en pantalla obliga a aprender vocabulario
    // del sistema sin que cambie ninguna decisión.
    key: "enviado",
    label: "Enviado",
    tono: "sent",
    hint: "Salió correctamente y está camino del destinatario.",
    condiciones: [{ estados: ["ENVIANDO", "ACEPTADO", "ENVIADO"], momento: "cualquiera" }],
  },
  {
    key: "entregado",
    label: "Entregado",
    tono: "done",
    hint: "Llegó al destinatario.",
    condiciones: [{ estados: ["ENTREGADO"], momento: "cualquiera" }],
  },
  {
    key: "leido",
    label: "Leído",
    tono: "done",
    hint: "El destinatario lo abrió.",
    condiciones: [{ estados: ["LEIDO"], momento: "cualquiera" }],
  },
  {
    // Un OMITIDO vencido entra aquí y uno futuro no: al futuro nadie lo ha
    // intentado todavía, así que contarlo como no entregado inventa un fallo
    // y esconde los de verdad entre el ruido.
    key: "no_entregado",
    label: "No entregado",
    tono: "problem",
    hint: "Le tocaba salir y no llegó al destinatario.",
    condiciones: [
      { estados: ["FALLIDO", "REBOTADO"], momento: "cualquiera" },
      { estados: ["OMITIDO"], momento: "vencido" },
    ],
  },
  {
    key: "cancelado",
    label: "Cancelado",
    tono: "problem",
    hint: "Se canceló antes de salir.",
    condiciones: [{ estados: ["CANCELADO"], momento: "cualquiera" }],
  },
  {
    key: "prueba",
    label: "Prueba",
    tono: "test",
    hint: "Prueba interna: no se contactó a nadie.",
    condiciones: [{ estados: ["SIMULADO"], momento: "cualquiera" }],
  },
];

const POR_KEY = new Map(ESTADOS_VISIBLES.map((estado) => [estado.key, estado]));

export function estadoVisible(key: EstadoVisibleKey): EstadoVisible {
  const estado = POR_KEY.get(key);
  if (!estado) throw new Error(`Estado visible desconocido: ${key}`);
  return estado;
}

export function esEstadoVisible(value: string | undefined): value is EstadoVisibleKey {
  return value !== undefined && POR_KEY.has(value as EstadoVisibleKey);
}

function condicionAWhere(condicion: Condicion, ahora: Date): Prisma.OutboundMessageWhereInput {
  const estados: Prisma.OutboundMessageWhereInput = { status: { in: condicion.estados } };
  if (condicion.momento === "vencido") return { ...estados, scheduledAt: { lte: ahora } };
  if (condicion.momento === "futuro") return { ...estados, scheduledAt: { gt: ahora } };
  return estados;
}

/** Consulta del estado. La usan por igual el contador y la lista filtrada. */
export function filtroDe(key: EstadoVisibleKey, ahora: Date): Prisma.OutboundMessageWhereInput {
  const { condiciones } = estadoVisible(key);
  if (condiciones.length === 1) return condicionAWhere(condiciones[0], ahora);
  return { OR: condiciones.map((condicion) => condicionAWhere(condicion, ahora)) };
}

function cumple(condicion: Condicion, status: MessageStatus, scheduledAt: Date | string | null | undefined, ahora: Date): boolean {
  if (!condicion.estados.includes(status)) return false;
  if (condicion.momento === "cualquiera") return true;
  const fecha = typeof scheduledAt === "string" ? new Date(scheduledAt) : scheduledAt;
  // Sin fecha utilizable no se puede afirmar que sea futuro. Se trata como
  // vencido, que es la lectura prudente: un aviso sin hora no está esperando.
  const esFuturo = fecha instanceof Date && !Number.isNaN(fecha.getTime()) && fecha.getTime() > ahora.getTime();
  return condicion.momento === "futuro" ? esFuturo : !esFuturo;
}

/** Estado visible de una fila concreta, con las mismas reglas que la consulta. */
export function estadoVisibleDe(
  status: MessageStatus,
  scheduledAt: Date | string | null | undefined,
  ahora = new Date(),
): EstadoVisible {
  const encontrado = ESTADOS_VISIBLES.find((estado) =>
    estado.condiciones.some((condicion) => cumple(condicion, status, scheduledAt, ahora)),
  );
  // No debería ocurrir: la prueba de cobertura exige que los once estados
  // internos caigan en alguno. Si algún día se añade un estado a Prisma y se
  // olvida aquí, es mejor decir "no clasificado" que fingir que salió bien.
  return encontrado ?? {
    key: "no_entregado",
    label: "Sin clasificar",
    tono: "problem",
    hint: "El sistema no supo interpretar el estado de este mensaje.",
    condiciones: [],
  };
}
