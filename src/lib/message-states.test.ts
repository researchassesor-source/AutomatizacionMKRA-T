import type { MessageStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ESTADOS_VISIBLES, esEstadoVisible, estadoVisibleDe, filtroDe } from "./message-states";

const TODOS: MessageStatus[] = [
  "PROGRAMADO", "ENVIANDO", "ACEPTADO", "ENVIADO", "ENTREGADO",
  "LEIDO", "REBOTADO", "SIMULADO", "FALLIDO", "CANCELADO", "OMITIDO",
];

const AHORA = new Date("2026-08-08T18:00:00.000Z");
const FUTURO = new Date("2026-08-20T18:00:00.000Z");
const VENCIDO = new Date("2026-08-01T18:00:00.000Z");

describe("cobertura del catálogo de estados", () => {
  it("cada estado interno cae en exactamente uno visible, venza cuando venza", () => {
    // Sin esto un estado podria no aparecer en ningun filtro (invisible para
    // Direccion) o aparecer en dos (los contadores sumarian mas que el total).
    for (const status of TODOS) {
      for (const cuando of [FUTURO, VENCIDO]) {
        const coincidencias = ESTADOS_VISIBLES.filter(
          (estado) => estadoVisibleDe(status, cuando, AHORA).key === estado.key,
        );
        expect(coincidencias, `${status} programado para ${cuando.toISOString()}`).toHaveLength(1);
      }
    }
  });

  it("los ocho estados operativos existen con el nombre que usa Dirección", () => {
    const etiquetas = ESTADOS_VISIBLES.map((estado) => estado.label);
    expect(etiquetas).toEqual([
      "Programado",
      "Listo para enviar",
      "Requiere configuración",
      "Enviado",
      "Entregado",
      "Leído",
      "No entregado",
      "Cancelado",
      // "Prueba" no es un estado operativo: es lo que produce el modo
      // simulación. Se lista aparte pero necesita filtro propio, o los
      // ensayos internos se contarían junto a los envíos reales.
      "Prueba",
    ]);
  });

  it("ninguna etiqueta filtra vocabulario del sistema", () => {
    for (const estado of ESTADOS_VISIBLES) {
      const texto = `${estado.label} ${estado.hint}`;
      // Los nombres internos van en mayusculas; se comparan tal cual porque
      // "Programado" es castellano correcto y "PROGRAMADO" es jerga del
      // sistema, y solo la segunda sobra en pantalla.
      expect(texto).not.toMatch(/OMITIDO|ACEPTADO|SIMULADO|PROGRAMADO|REBOTADO|LEIDO/);
      expect(texto).not.toMatch(/webhook|token|wamid|template|plantilla|payload/i);
    }
  });
});

describe("el filtro y la clasificación son la misma definición", () => {
  it("el programado futuro y el vencido no se mezclan", () => {
    expect(estadoVisibleDe("PROGRAMADO", FUTURO, AHORA).key).toBe("programado");
    expect(estadoVisibleDe("PROGRAMADO", VENCIDO, AHORA).key).toBe("listo");
  });

  it("el aviso futuro sin datos requiere configuración; el vencido no se entregó", () => {
    expect(estadoVisibleDe("OMITIDO", FUTURO, AHORA).key).toBe("requiere_config");
    expect(estadoVisibleDe("OMITIDO", VENCIDO, AHORA).key).toBe("no_entregado");
  });

  it("la consulta de cada estado usa el mismo instante que la clasificación", () => {
    expect(filtroDe("programado", AHORA)).toEqual({ status: { in: ["PROGRAMADO"] }, scheduledAt: { gt: AHORA } });
    expect(filtroDe("listo", AHORA)).toEqual({ status: { in: ["PROGRAMADO"] }, scheduledAt: { lte: AHORA } });
    expect(filtroDe("entregado", AHORA)).toEqual({ status: { in: ["ENTREGADO"] } });
  });

  it("«No entregado» agrupa los rechazos y los avisos vencidos sin preparar", () => {
    expect(filtroDe("no_entregado", AHORA)).toEqual({
      OR: [
        { status: { in: ["FALLIDO", "REBOTADO"] } },
        { status: { in: ["OMITIDO"] }, scheduledAt: { lte: AHORA } },
      ],
    });
  });

  it("un estado que no existe no se acepta como filtro", () => {
    expect(esEstadoVisible("no_entregado")).toBe(true);
    expect(esEstadoVisible("OMITIDO")).toBe(false);
    expect(esEstadoVisible(undefined)).toBe(false);
  });

  it("sin fecha utilizable el mensaje no se da por futuro", () => {
    // Un aviso sin hora no esta esperando su turno: darlo por futuro lo
    // escondería del recuento de problemas para siempre.
    expect(estadoVisibleDe("OMITIDO", null, AHORA).key).toBe("no_entregado");
    expect(estadoVisibleDe("PROGRAMADO", "no-es-fecha", AHORA).key).toBe("listo");
  });
});
