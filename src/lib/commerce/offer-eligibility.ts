import type { CampaignAudienceMode, FinanceCommercialState, OfferRecipientEligibility } from "@prisma/client";

/**
 * Quien puede recibir la oferta de certificacion institucional.
 *
 * El nucleo de este archivo es una distincion que NO puede difuminarse:
 *
 *   HISTORICAL_MANUAL  -> decide una persona. Los cursos anteriores no tienen
 *                         CRMCompras, asi que deducir quien compro a partir del
 *                         importe, del estado de la inscripcion o de cualquier
 *                         campo heredado seria inventar. El administrador tiene
 *                         la lista real; el sistema solo ejecuta y audita.
 *
 *   AUTOMATIC_COMMERCE -> decide Finance. Ahi si es fuente de verdad, y solo
 *                         quien no tiene ninguna compra recibe la oferta.
 *
 * Aplicar las reglas automaticas a datos historicos escribiria a personas que
 * ya pagaron, o dejaria fuera a quienes debian recibirla. Por eso el modo no es
 * una preferencia de la interfaz: gobierna la decision.
 */

/** Estados de Finance que significan "ya compro algo": no recibe la oferta. */
const ESTADOS_CON_COMPRA: FinanceCommercialState[] = [
  "FULL_PENDING",
  "FULL_VERIFIED",
  "INSTITUTIONAL_PENDING",
  "INSTITUTIONAL_VERIFIED",
  "UPGRADE_PENDING",
  "FULL_UPGRADED",
];

export type DestinatarioEstado = {
  manualExcludedAt?: Date | null;
  manualSentAt?: Date | null;
  automaticSentAt?: Date | null;
  manuallyApprovedAt?: Date | null;
};

export type Decision = {
  elegible: boolean;
  estado: OfferRecipientEligibility;
  motivo: string | null;
};

/**
 * Puede enviarse AHORA a esta persona, en modo automatico.
 *
 * Fail closed: si Finance no contesta o devuelve algo que no entendemos, no se
 * envia. Una oferta de pago a alguien que ya pago es un error caro y visible;
 * no enviarla se corrige con un clic.
 */
export function decidirAutomatico(
  destinatario: DestinatarioEstado,
  estadoFinance: FinanceCommercialState | null,
): Decision {
  if (destinatario.manualExcludedAt) {
    return { elegible: false, estado: "EXCLUDED", motivo: "Excluido manualmente." };
  }
  if (destinatario.manualSentAt || destinatario.automaticSentAt) {
    // Manual y automatico son el MISMO mensaje comercial. Haber salido por una
    // via cierra la otra.
    return { elegible: false, estado: "SENT", motivo: "Ya se le envió la oferta." };
  }
  if (estadoFinance === null) {
    return { elegible: false, estado: "ERROR", motivo: "No se pudo consultar el estado comercial en Finance." };
  }
  if (estadoFinance === "LEGACY_UNCLASSIFIED") {
    // Finance no sabe clasificarlo. Automatico jamas; una persona puede
    // decidirlo a mano y esa decision queda auditada.
    return { elegible: false, estado: "REQUIRES_REVIEW", motivo: "Finance no pudo clasificar esta compra. Requiere revisión manual." };
  }
  if (ESTADOS_CON_COMPRA.includes(estadoFinance)) {
    const pendiente = estadoFinance.endsWith("_PENDING");
    return {
      elegible: false,
      estado: pendiente ? "NOT_ELIGIBLE_PENDING_PAYMENT" : "NOT_ELIGIBLE_PURCHASED",
      motivo: pendiente ? "Tiene una compra con el pago pendiente." : "Ya compró una modalidad de este curso.",
    };
  }
  if (estadoFinance === "CANCELLED") {
    // Una compra cancelada no concede derecho, pero tampoco es un "sin compra"
    // limpio: hubo una operacion. Se revisa antes de volver a ofrecer.
    return { elegible: false, estado: "REQUIRES_REVIEW", motivo: "Tiene una compra cancelada. Requiere revisión manual." };
  }
  return { elegible: true, estado: "ELIGIBLE", motivo: null };
}

/**
 * Puede enviarse a mano a esta persona.
 *
 * En modo historico la seleccion del administrador ES la aprobacion: su clic
 * queda auditado y sustituye a la clasificacion que el sistema no puede hacer.
 * Por eso `LEGACY_UNCLASSIFIED` no bloquea aqui, aunque si bloquee en
 * automatico. Lo unico que gana siempre es la exclusion manual.
 */
export function decidirManual(
  destinatario: DestinatarioEstado,
  modo: CampaignAudienceMode,
  estadoFinance: FinanceCommercialState | null,
): Decision {
  if (destinatario.manualExcludedAt) {
    return { elegible: false, estado: "EXCLUDED", motivo: "Excluido manualmente." };
  }
  if (destinatario.manualSentAt || destinatario.automaticSentAt) {
    return { elegible: false, estado: "SENT", motivo: "Ya se le envió la oferta." };
  }
  if (modo === "HISTORICAL_MANUAL") {
    // Ningun campo heredado decide aqui. Ni importe, ni estado de inscripcion,
    // ni financeStatus. Decide quien pulsa.
    return { elegible: true, estado: "ELIGIBLE", motivo: null };
  }
  // En cursos nuevos Finance si manda, pero un estado no clasificado no impide
  // el envio manual: solo se advierte.
  if (estadoFinance && ESTADOS_CON_COMPRA.includes(estadoFinance)) {
    const pendiente = estadoFinance.endsWith("_PENDING");
    return {
      elegible: false,
      estado: pendiente ? "NOT_ELIGIBLE_PENDING_PAYMENT" : "NOT_ELIGIBLE_PURCHASED",
      motivo: pendiente ? "Tiene una compra con el pago pendiente." : "Ya compró una modalidad de este curso.",
    };
  }
  return { elegible: true, estado: "ELIGIBLE", motivo: null };
}

/**
 * ¿Hay que advertir sobre el estado comercial al seleccionar a mano?
 *
 * En modo historico no se bloquea, pero callar un estado explicito de Finance
 * seria esconder informacion util justo cuando alguien esta decidiendo.
 */
export function advertenciaComercial(estadoFinance: FinanceCommercialState | null): string | null {
  if (!estadoFinance || estadoFinance === "NO_PURCHASE") return null;
  if (estadoFinance === "LEGACY_UNCLASSIFIED") return null;
  if (estadoFinance === "CANCELLED") return "Finance registra una compra cancelada para esta persona.";
  if (ESTADOS_CON_COMPRA.includes(estadoFinance)) {
    return estadoFinance.endsWith("_PENDING")
      ? "Finance registra una compra con el pago pendiente."
      : "Finance registra que esta persona ya compró una modalidad.";
  }
  return null;
}

/** Identidad compartida por el envio manual y el automatico. */
export const OFFER_STEP_KEY = "institutional-offer";
export function offerSequenceKey(courseId: string): string {
  return `certification-offer:${courseId}`;
}
