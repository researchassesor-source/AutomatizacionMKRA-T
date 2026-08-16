import type { CertificationTier, CoursePurchaseStatus, CoursePurchaseType } from "@prisma/client";

/**
 * Que derecho concede lo que la persona ha pagado.
 *
 * Una sola regla gobierna este archivo: el derecho lo concede un pago
 * VERIFICADO por Finance, nada mas. Ni el importe, ni el estado administrativo
 * de la inscripcion, ni que la compra exista en Finance. Registrar una compra
 * y cobrarla son dos hechos distintos, y confundirlos daria acceso gratis.
 */

export type CompraMinima = {
  offerType: CoursePurchaseType;
  status: CoursePurchaseStatus;
  parentPurchaseId?: string | null;
  id?: string;
};

export type DerechoResuelto = {
  tier: CertificationTier;
  accesoCursoCompleto: boolean;
};

const VERIFICADO: CoursePurchaseStatus = "PAYMENT_VERIFIED";

/**
 * Nivel de certificacion y acceso a partir de las compras.
 *
 *   FULL verificada                          -> FULL
 *   INSTITUTIONAL verificada                 -> INSTITUTIONAL
 *   INSTITUTIONAL + AVAL_UPGRADE verificadas -> FULL
 *
 * El acceso al curso de 60 horas es el mismo en las dos modalidades: lo que
 * cambia es el certificado. Por eso una mejora NO vuelve a conceder acceso, ya
 * lo tenia; solo eleva el nivel.
 */
export function resolverDerecho(compras: readonly CompraMinima[]): DerechoResuelto {
  const verificadas = compras.filter((compra) => compra.status === VERIFICADO);
  const tieneFull = verificadas.some((compra) => compra.offerType === "FULL");
  const tieneInstitucional = verificadas.some((compra) => compra.offerType === "INSTITUTIONAL");
  // Una mejora solo cuenta si su compra institucional tambien esta verificada:
  // pagar la mejora sin haber pagado la base no puede dar el nivel completo.
  const tieneMejora = verificadas.some(
    (compra) => compra.offerType === "AVAL_UPGRADE" && verificadas.some((padre) => padre.id && padre.id === compra.parentPurchaseId),
  );

  if (tieneFull || (tieneInstitucional && tieneMejora)) {
    return { tier: "FULL", accesoCursoCompleto: true };
  }
  if (tieneInstitucional) {
    return { tier: "INSTITUTIONAL", accesoCursoCompleto: true };
  }
  return { tier: "NONE", accesoCursoCompleto: false };
}

export type ProblemaCompra = { codigo: string; mensaje: string };

/**
 * Comprueba si una compra nueva puede crearse sobre las que ya existen.
 *
 * Devuelve el motivo en lugar de lanzar: quien llama lo muestra en pantalla, y
 * un texto concreto ahorra tener que mirar la base para entender el rechazo.
 */
export function validarCompraNueva(
  nueva: { offerType: CoursePurchaseType; parentPurchaseId?: string | null },
  existentes: readonly CompraMinima[],
): ProblemaCompra | null {
  const vivas = existentes.filter((compra) => compra.status !== "CANCELLED");

  if (nueva.offerType === "AVAL_UPGRADE") {
    if (!nueva.parentPurchaseId) {
      return { codigo: "UPGRADE_SIN_PADRE", mensaje: "La mejora con aval externo necesita indicar la compra institucional que mejora." };
    }
    const padre = vivas.find((compra) => compra.id === nueva.parentPurchaseId);
    if (!padre) {
      return { codigo: "UPGRADE_PADRE_INEXISTENTE", mensaje: "La compra institucional indicada no existe en esta inscripción." };
    }
    if (padre.offerType !== "INSTITUTIONAL") {
      return { codigo: "UPGRADE_PADRE_INVALIDO", mensaje: "La mejora con aval solo puede aplicarse sobre una compra institucional." };
    }
    if (padre.status !== VERIFICADO) {
      // Es la condicion del negocio: la mejora se ofrece a quien YA pago la
      // institucional. Permitirla antes venderia un aval sobre un pago que
      // podria no llegar nunca.
      return { codigo: "UPGRADE_PADRE_SIN_PAGO", mensaje: "La compra institucional todavía no tiene el pago verificado, así que aún no puede mejorarse." };
    }
    if (vivas.some((compra) => compra.offerType === "AVAL_UPGRADE")) {
      return { codigo: "UPGRADE_DUPLICADO", mensaje: "Esta inscripción ya tiene una mejora con aval registrada." };
    }
    return null;
  }

  if (vivas.some((compra) => compra.offerType === nueva.offerType)) {
    return { codigo: "COMPRA_DUPLICADA", mensaje: "Esta inscripción ya tiene una compra de esa modalidad." };
  }
  // FULL e INSTITUTIONAL son alternativas del mismo curso: tener las dos
  // significaria haber pagado dos veces por el mismo acceso.
  if (vivas.some((compra) => compra.offerType === "FULL" || compra.offerType === "INSTITUTIONAL")) {
    return {
      codigo: "MODALIDAD_INCOMPATIBLE",
      mensaje: "Esta inscripción ya tiene una modalidad comprada. Para añadir el aval externo se usa la mejora, no una compra nueva.",
    };
  }
  return null;
}
