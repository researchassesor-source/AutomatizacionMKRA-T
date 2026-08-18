import type { CoursePurchaseStatus, EnrollmentStatus } from "@prisma/client";

/**
 * Quien tiene derecho OPERATIVO a un curso: a recibir sus accesos y su journey.
 *
 * Una sola regla gobierna este archivo. En un curso de pago el derecho lo
 * concede un pago verificado, y nada mas: ni haber rellenado el formulario, ni
 * haber subido un comprobante, ni que exista una compra registrada, ni que
 * Finance haya emitido la factura. Registrar una compra y cobrarla son hechos
 * distintos, y tratarlos como uno solo regala el curso.
 *
 * En un taller gratuito el derecho lo concede el registro, porque no hay nada
 * que cobrar.
 *
 * Es distinto de `resolverDerecho` (entitlement.ts): aquel decide el nivel de
 * certificacion que dan las compras del curso completo de 60 horas; este decide
 * si la persona puede entrar al curso en el que se inscribio.
 *
 * Vive en un solo sitio a proposito. La misma pregunta se hace desde la
 * interfaz, el programador de mensajes y el despachador, y tres copias que
 * pueden discrepar es exactamente como se envia un acceso a quien no pago.
 */

/** La gratuidad es explicita: la declara el curso, no se deduce del precio. */
export type CursoConAcceso = { isFree: boolean };
export type InscripcionConAcceso = { status: EnrollmentStatus };
export type CompraConEstado = { status: CoursePurchaseStatus };

export type MotivoAcceso =
  | "GRATUITO"
  | "PAGO_VERIFICADO"
  | "PAGO_PENDIENTE"
  | "SIN_PAGO"
  | "INSCRIPCION_CANCELADA";

export type AccesoAlCurso = {
  habilitado: boolean;
  motivo: MotivoAcceso;
  /** Texto para la interfaz. No sustituye al estado comercial, lo acompaña. */
  etiqueta: string;
};

const VERIFICADO: CoursePurchaseStatus = "PAYMENT_VERIFIED";

const ETIQUETAS: Record<MotivoAcceso, string> = {
  GRATUITO: "Gratuito · habilitado",
  PAGO_VERIFICADO: "Habilitado",
  PAGO_PENDIENTE: "Pendiente de pago",
  SIN_PAGO: "Pendiente de pago",
  INSCRIPCION_CANCELADA: "Inscripción cancelada",
};

function resultado(habilitado: boolean, motivo: MotivoAcceso): AccesoAlCurso {
  return { habilitado, motivo, etiqueta: ETIQUETAS[motivo] };
}

/**
 * ¿Esta inscripcion da derecho a entrar al curso?
 *
 * Falla cerrado: cualquier situacion que no sea "gratuito" o "pago verificado"
 * devuelve `false`. Un estado nuevo de compra que nadie previo aqui no puede
 * abrir la puerta por omision.
 */
export function courseAccessEligibility(
  curso: CursoConAcceso,
  inscripcion: InscripcionConAcceso,
  compras: readonly CompraConEstado[] = [],
): AccesoAlCurso {
  // Una inscripcion cancelada no recibe nada, ni siquiera de un curso gratuito.
  if (inscripcion.status === "CANCELADO") return resultado(false, "INSCRIPCION_CANCELADA");
  if (curso.isFree) return resultado(true, "GRATUITO");
  if (compras.some((compra) => compra.status === VERIFICADO)) return resultado(true, "PAGO_VERIFICADO");
  if (compras.length === 0) return resultado(false, "SIN_PAGO");
  return resultado(false, "PAGO_PENDIENTE");
}

/** Atajo para quien solo necesita el si/no. */
export function participantHasCourseEntitlement(
  curso: CursoConAcceso,
  inscripcion: InscripcionConAcceso,
  compras: readonly CompraConEstado[] = [],
): boolean {
  return courseAccessEligibility(curso, inscripcion, compras).habilitado;
}

/**
 * Momentos del journey escritos para el embudo gratuito.
 *
 * Sus textos, ya aprobados en Meta, dicen literalmente "esta capacitación
 * gratuita" y ofrecen la version completa como paso siguiente. Enviarlos a
 * quien acaba de pagar el curso le diria que lo que pago era gratis y le
 * ofreceria comprar lo que ya tiene.
 *
 * Se resuelve no programandolos, no reescribiendo el texto: los contratos con
 * Meta estan validados y cambiarlos exigiria otra revision. Si en el futuro un
 * curso de pago necesita su propio cierre comercial, sera una plantilla nueva.
 */
const SOLO_EMBUDO_GRATUITO = new Set(["course_complete", "course_follow_up"]);

export function momentoAplicaAlCurso(planKey: string | null | undefined, curso: CursoConAcceso): boolean {
  if (!planKey) return true;
  if (!SOLO_EMBUDO_GRATUITO.has(planKey)) return true;
  return curso.isFree;
}
