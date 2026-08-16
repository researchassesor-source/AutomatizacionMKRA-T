/**
 * Como se presenta la campaña de oferta institucional.
 *
 * Vive fuera del componente para poder probarlo sin montar un navegador, y
 * porque separa con claridad lo que hace cada capa: aqui NO se decide nada
 * sobre elegibilidad, solo se traduce a texto lo que el backend ya decidio.
 * Duplicar la elegibilidad en React acabaria con dos versiones que discrepan y
 * una pantalla que promete algo que el servidor no va a hacer.
 */

export type DestinatarioVista = {
  enrollmentId: string;
  telefono: string | null;
  estado: string;
  estadoComercial: string | null;
  seleccionado: boolean;
  excluido: boolean;
  enviadoManual: string | null;
  enviadoAutomatico: string | null;
};

export type ModoCampana = "HISTORICAL_MANUAL" | "AUTOMATIC_COMMERCE";

export const ESTADO_CAMPANA: Record<string, string> = {
  DRAFT: "Preparada",
  SCHEDULED: "Programada",
  RUNNING: "Procesando",
  COMPLETED: "Ejecutada",
  CANCELLED: "Cancelada",
};

/**
 * Etiqueta de cada persona.
 *
 * El orden importa: lo ya ocurrido manda sobre lo que Finance opine. A quien
 * ya se le escribio esta "enviado", no "no elegible", aunque despues comprara.
 */
export function etiquetaOferta(destinatario: DestinatarioVista): { texto: string; clase: string } {
  if (destinatario.enviadoManual) return { texto: "Enviado manualmente", clase: "ok" };
  if (destinatario.enviadoAutomatico) return { texto: "Enviado automáticamente", clase: "ok" };
  if (destinatario.excluido) return { texto: "Excluido", clase: "warn" };
  if (destinatario.estado === "ERROR") return { texto: "Error", clase: "err" };
  if (destinatario.estado === "REQUIRES_REVIEW") return { texto: "Requiere revisión", clase: "warn" };
  if (destinatario.estado === "NOT_ELIGIBLE_PURCHASED") return { texto: "Ya compró", clase: "info" };
  if (destinatario.estado === "NOT_ELIGIBLE_PENDING_PAYMENT") return { texto: "Pago pendiente", clase: "info" };
  if (destinatario.seleccionado) return { texto: "Seleccionado", clase: "info" };
  return { texto: "Pendiente", clase: "" };
}

/**
 * Estado comercial en lenguaje entendible.
 *
 * En campañas historicas es SOLO informativo. Los cursos anteriores no tienen
 * CRMCompras, asi que Finance no puede saber quien compro; presentarlo como un
 * veredicto seria afirmar de mas.
 */
export function etiquetaComercial(estado: string | null, modo: ModoCampana): string {
  if (!estado) return modo === "HISTORICAL_MANUAL" ? "Histórico — sin dato" : "Sin consultar";
  const mapa: Record<string, string> = {
    NO_PURCHASE: "Sin compra",
    FULL_PENDING: "Completa · pago pendiente",
    FULL_VERIFIED: "Completa · pagada",
    INSTITUTIONAL_PENDING: "Institucional · pago pendiente",
    INSTITUTIONAL_VERIFIED: "Institucional · pagada",
    UPGRADE_PENDING: "Mejora · pago pendiente",
    FULL_UPGRADED: "Completa por mejora",
    CANCELLED: "Compra cancelada",
    LEGACY_UNCLASSIFIED: "Histórico — revisión manual",
  };
  return mapa[estado] ?? estado;
}

/**
 * ¿Se puede marcar a esta persona para enviarle la oferta?
 *
 * Es solo la capa visual: evita ofrecer una accion que se sabe que no va a
 * proceder. El backend vuelve a comprobarlo todo y es quien manda.
 *
 * En modo historico el estado comercial NO entra: aunque Finance diga que ya
 * compro, en datos anteriores ese dato no es fiable y decide el administrador.
 */
export function puedeSeleccionarse(destinatario: DestinatarioVista, puedeEditar: boolean): boolean {
  if (!puedeEditar) return false;
  if (destinatario.enviadoManual || destinatario.enviadoAutomatico) return false;
  if (destinatario.excluido) return false;
  // Sin numero no hay a donde escribir; ofrecerlo seria un fallo garantizado.
  return Boolean(destinatario.telefono);
}

/** Quienes quedan disponibles al pulsar «Seleccionar todos». */
export function seleccionablesDe(destinatarios: readonly DestinatarioVista[], puedeEditar: boolean): string[] {
  return destinatarios.filter((d) => puedeSeleccionarse(d, puedeEditar)).map((d) => d.enrollmentId);
}

/** ¿Puede pulsarse «Enviar ahora»? */
export function puedeEnviar(opciones: {
  puedeEditar: boolean;
  urlOferta: string | null;
  marcados: readonly string[];
  ocupado: boolean;
}): boolean {
  // Fail closed sobre la URL: sin destino no se escribe a nadie, aunque el
  // backend lo rechazaria igualmente.
  if (!opciones.puedeEditar || !opciones.urlOferta?.trim()) return false;
  if (opciones.marcados.length === 0) return false;
  return !opciones.ocupado;
}

/** Texto de la confirmacion previa al envio. */
export function textoConfirmacion(contadores: {
  marcados: number;
  enviadosManualmente: number;
  excluidos: number;
  pendientes: number;
}): string {
  return `Se preparará la oferta para ${contadores.marcados} participante(s). Ya enviados: ${contadores.enviadosManualmente}. Excluidos: ${contadores.excluidos}. Pendientes: ${contadores.pendientes}.`;
}
