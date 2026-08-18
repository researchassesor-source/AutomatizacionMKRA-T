import type { CoursePurchaseStatus, CoursePurchaseType } from "@prisma/client";
import { ESTADO_PAGO_VERIFICADO } from "@/lib/commerce/course-entitlement";

/**
 * Progreso del pasaporte de cinco cursos.
 *
 * Un curso cuenta cuando la persona lo PAGO de verdad. No cuenta haber
 * asistido, haberse inscrito, haber rellenado el formulario ni que exista una
 * factura: son hechos distintos del cobro, y confundirlos regalaria el
 * pasaporte a quien solo paso por una actividad gratuita.
 *
 * Deliberadamente NO se usa `Enrollment.status === "COMPLETADO"`. Ese estado
 * describe el recorrido operativo del curso —si termino, si se cancelo— y
 * redefinirlo ahora cambiaria el significado de datos que ya existen y de las
 * automatizaciones que lo consultan.
 *
 * Todo esto es derivado: no hay columna que mantener ni backfill que hacer, y
 * por tanto no puede quedar desincronizado de las compras reales.
 */

/** Modalidades que representan haber comprado EL curso. */
const COMPRAS_BASE: ReadonlySet<CoursePurchaseType> = new Set(["FULL", "INSTITUTIONAL"]);

export type CompraDePasaporte = { offerType: CoursePurchaseType; status: CoursePurchaseStatus };

/**
 * ¿Esta inscripcion cuenta para el pasaporte?
 *
 * `AVAL_UPGRADE` nunca basta por si sola: es una mejora del certificado de un
 * curso que ya se compro, no un curso mas. Contarla sumaria dos por una sola
 * formacion.
 */
export function courseCountsTowardPassport(compras: readonly CompraDePasaporte[]): boolean {
  return compras.some((compra) => compra.status === ESTADO_PAGO_VERIFICADO && COMPRAS_BASE.has(compra.offerType));
}

export type MotivoNoCuenta = "SIN_COMPRA" | "PAGO_PENDIENTE" | "SOLO_MEJORA" | "COMPRA_CANCELADA";

/** Por que una inscripcion todavia no suma, en terminos que se puedan mostrar. */
export function motivoNoCuenta(compras: readonly CompraDePasaporte[]): MotivoNoCuenta {
  const vivas = compras.filter((c) => c.status !== "CANCELLED");
  if (vivas.length === 0) return compras.length > 0 ? "COMPRA_CANCELADA" : "SIN_COMPRA";
  const soloMejora = vivas.every((c) => c.offerType === "AVAL_UPGRADE");
  if (soloMejora) return "SOLO_MEJORA";
  return "PAGO_PENDIENTE";
}

export const ETIQUETA_NO_CUENTA: Record<MotivoNoCuenta, string> = {
  SIN_COMPRA: "Todavía no cuenta · sin compra registrada",
  PAGO_PENDIENTE: "Todavía no cuenta · pago pendiente",
  SOLO_MEJORA: "Todavía no cuenta · solo mejora de certificado",
  COMPRA_CANCELADA: "Todavía no cuenta · compra cancelada",
};

export type InscripcionDePasaporte = {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  isFree: boolean;
  purchases: readonly CompraDePasaporte[];
};

export type LineaDePasaporte = {
  enrollmentId: string;
  courseId: string;
  courseTitle: string;
  cuenta: boolean;
  etiqueta: string;
};

export type ProgresoPasaporte = {
  /** Cursos DISTINTOS con compra base verificada. */
  contabilizados: number;
  meta: number;
  lineas: LineaDePasaporte[];
};

export const META_PASAPORTE = 5;

/**
 * Progreso de una persona a partir de todas sus inscripciones.
 *
 * Cuenta cursos distintos, no compras: quien tiene la institucional y ademas
 * su mejora con aval sigue habiendo hecho UN curso, y dos inscripciones al
 * mismo curso tampoco suman dos.
 */
export function calcularPasaporte(inscripciones: readonly InscripcionDePasaporte[]): ProgresoPasaporte {
  const cursosQueCuentan = new Set<string>();
  const lineas: LineaDePasaporte[] = [];

  for (const inscripcion of inscripciones) {
    const cuenta = courseCountsTowardPassport(inscripcion.purchases);
    if (cuenta) cursosQueCuentan.add(inscripcion.courseId);
    lineas.push({
      enrollmentId: inscripcion.enrollmentId,
      courseId: inscripcion.courseId,
      courseTitle: inscripcion.courseTitle,
      cuenta,
      // La gratuidad se declara en el curso: decirlo asi evita que parezca que
      // a esa persona le falta pagar algo que nunca tuvo precio.
      etiqueta: cuenta
        ? "Curso contabilizado · pago verificado"
        : inscripcion.isFree
          ? "Actividad gratuita · no cuenta"
          : ETIQUETA_NO_CUENTA[motivoNoCuenta(inscripcion.purchases)],
    });
  }

  return { contabilizados: cursosQueCuentan.size, meta: META_PASAPORTE, lineas };
}
