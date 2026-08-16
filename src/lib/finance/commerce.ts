import { z } from "zod";
import { authedCall } from "./client";

/**
 * Contrato comercial con Finance (hoja CRMCompras).
 *
 * Convive con el traspaso heredado sin tocarlo: `createInscripcion` sigue
 * siendo la inscripcion academica y esto es la capa de compras, que Finance
 * modela aparte por CRMOrderID. Se reutiliza `authedCall` para no abrir un
 * segundo transporte con su propio token y su propio reintento.
 *
 * Todo lo que llega de Finance se valida antes de usarse. Un estado comercial
 * mal escrito no puede colarse como si fuera valido: de el depende si alguien
 * recibe o no una oferta de pago, y adivinar ahi es peor que fallar.
 */

export const OFFER_TYPES = ["FULL", "INSTITUTIONAL", "AVAL_UPGRADE"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const COMMERCIAL_STATES = [
  "NO_PURCHASE",
  "FULL_PENDING",
  "FULL_VERIFIED",
  "INSTITUTIONAL_PENDING",
  "INSTITUTIONAL_VERIFIED",
  "UPGRADE_PENDING",
  "FULL_UPGRADED",
  "CANCELLED",
  "LEGACY_UNCLASSIFIED",
] as const;
export type CommercialState = (typeof COMMERCIAL_STATES)[number];

export const ENTITLEMENTS = ["NONE", "INSTITUTIONAL", "FULL"] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

/** Tope que impone Finance para las consultas por lote. */
export const MAX_COMMERCE_BATCH = 100;

const purchaseSchema = z.object({
  crmOrderId: z.string(),
  offerType: z.enum(OFFER_TYPES),
  parentCrmOrderId: z.string().nullish(),
  amount: z.coerce.number(),
  paymentStatus: z.string(),
  paymentVerifiedAt: z.string().nullish(),
});

const commerceStateSchema = z.object({
  crmEnrollmentId: z.string(),
  financeInscripcionId: z.string().nullish(),
  commercialState: z.enum(COMMERCIAL_STATES),
  effectiveEntitlement: z.enum(ENTITLEMENTS),
  purchases: z.array(purchaseSchema).default([]),
  requiresExternalAval: z.boolean().nullish(),
  avalStatus: z.string().nullish(),
  completionStatus: z.string().nullish(),
  completedAt: z.string().nullish(),
});

export type FinanceCommerceState = z.infer<typeof commerceStateSchema>;

export type ImportPurchaseInput = {
  crmOrderId: string;
  crmEnrollmentId: string;
  crmContactId: string;
  crmCourseId: string;
  courseTitle: string;
  modality: string | null;
  startDate: string | null;
  endDate: string | null;
  participant: {
    fullName: string;
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    identification: string | null;
  };
  offerType: OfferType;
  parentCrmOrderId?: string | null;
  amount: number;
  institucionAval?: string | null;
};

export type ResultadoFinance<T> =
  | { ok: true; datos: T }
  | { ok: false; error: string };

/**
 * Respuesta documentada de `importCrmPurchase`.
 *
 * Finance devuelve aqui el estado del pago, pero eso NO significa que el pago
 * este hecho: en un alta recien creada llega como `PAYMENT_PENDING`. Se parsea
 * para no descartar informacion del contrato, y quien decide sobre el derecho
 * sigue siendo `esPagoVerificado`, que solo acepta `PAYMENT_VERIFIED`.
 *
 * Los campos van tolerantes a ausencia a proposito: si Finance añade o recorta
 * alguno, el registro de la compra no debe fallar por eso.
 */
const importResultSchema = z
  .object({
    crmOrderId: z.string().nullish(),
    financeInscripcionId: z.string().nullish(),
    offerType: z.enum(OFFER_TYPES).nullish(),
    parentCrmOrderId: z.string().nullish(),
    amount: z.coerce.number().nullish(),
    paymentStatus: z.string().nullish(),
    paymentVerifiedAt: z.string().nullish(),
    requiresExternalAval: z.boolean().nullish(),
    avalStatus: z.string().nullish(),
    certificateStatus: z.string().nullish(),
    completionStatus: z.string().nullish(),
    completedAt: z.string().nullish(),
  })
  .transform((datos) => ({
    crmOrderId: datos.crmOrderId ?? null,
    financeInscripcionId: datos.financeInscripcionId ?? null,
    paymentStatus: datos.paymentStatus ?? null,
    paymentVerifiedAt: datos.paymentVerifiedAt ?? null,
    requiresExternalAval: datos.requiresExternalAval ?? null,
    avalStatus: datos.avalStatus ?? null,
    certificateStatus: datos.certificateStatus ?? null,
  }));

export type ImportPurchaseResult = z.infer<typeof importResultSchema>;

/**
 * Traduce el sobre de Finance a un resultado explicito.
 *
 * Se devuelve un resultado en vez de lanzar porque quien llama casi siempre
 * tiene que decidir algo distinto segun el fallo: en modo automatico se cierra
 * la puerta, en modo manual solo se muestra un aviso.
 */
function interpretar<T>(
  respuesta: { success?: boolean; error?: string; data?: unknown },
  // La entrada se declara `unknown` a proposito: lo que llega de Finance no
  // tiene tipo hasta que el esquema lo valida.
  esquema: z.ZodType<T, z.ZodTypeDef, unknown>,
): ResultadoFinance<T> {
  if (!respuesta?.success) {
    return { ok: false, error: (respuesta?.error ?? "Finance rechazó la solicitud.").slice(0, 300) };
  }
  const validado = esquema.safeParse(respuesta.data);
  if (!validado.success) {
    // Un cuerpo que no cumple el contrato es un fallo, no un dato raro: usarlo
    // significaria decidir sobre pagos con informacion que no entendemos.
    return { ok: false, error: `Finance devolvió un cuerpo que no cumple el contrato: ${validado.error.errors[0]?.path.join(".") ?? "desconocido"}.` };
  }
  return { ok: true, datos: validado.data };
}

/**
 * Registra la compra en Finance.
 *
 * Importante: que Finance acepte el registro NO significa que el pago este
 * verificado. Solo confirma que la fila existe. El pago lo confirma despues
 * `paymentStatus`, y hasta entonces no se concede ningun derecho.
 */
export async function importCrmPurchase(input: ImportPurchaseInput): Promise<ResultadoFinance<ImportPurchaseResult>> {
  const respuesta = await authedCall<unknown>("importCrmPurchase", { ...input });
  return interpretar(respuesta as { success?: boolean; error?: string; data?: unknown }, importResultSchema);
}

export async function getCrmPurchaseStatus(crmOrderId: string): Promise<ResultadoFinance<{ crmOrderId: string; paymentStatus: string; paymentVerifiedAt: string | null }>> {
  const respuesta = await authedCall<unknown>("getCrmPurchaseStatus", { crmOrderId });
  return interpretar(
    respuesta as { success?: boolean; error?: string; data?: unknown },
    z.object({ crmOrderId: z.string(), paymentStatus: z.string(), paymentVerifiedAt: z.string().nullish() })
      .transform((d) => ({ ...d, paymentVerifiedAt: d.paymentVerifiedAt ?? null })),
  );
}

export async function getCrmPurchaseStatuses(crmOrderIds: readonly string[]): Promise<ResultadoFinance<Array<{ crmOrderId: string; paymentStatus: string; paymentVerifiedAt: string | null }>>> {
  if (crmOrderIds.length === 0) return { ok: true, datos: [] };
  if (crmOrderIds.length > MAX_COMMERCE_BATCH) {
    return { ok: false, error: `Finance admite como máximo ${MAX_COMMERCE_BATCH} compras por consulta.` };
  }
  const respuesta = await authedCall<unknown>("getCrmPurchaseStatuses", { crmOrderIds: [...crmOrderIds] });
  return interpretar(
    respuesta as { success?: boolean; error?: string; data?: unknown },
    z.array(z.object({ crmOrderId: z.string(), paymentStatus: z.string(), paymentVerifiedAt: z.string().nullish() }))
      .transform((lista) => lista.map((d) => ({ ...d, paymentVerifiedAt: d.paymentVerifiedAt ?? null }))),
  );
}

export async function getCrmEnrollmentCommerceState(crmEnrollmentId: string): Promise<ResultadoFinance<FinanceCommerceState>> {
  const respuesta = await authedCall<unknown>("getCrmEnrollmentCommerceState", { crmEnrollmentId });
  return interpretar(respuesta as { success?: boolean; error?: string; data?: unknown }, commerceStateSchema);
}

/**
 * Estado comercial de varias inscripciones. Es lo que alimenta la pantalla de
 * la campaña y la reevaluacion previa a cada envio.
 */
export async function getCrmEnrollmentCommerceStates(
  crmEnrollmentIds: readonly string[],
): Promise<ResultadoFinance<Map<string, FinanceCommerceState>>> {
  if (crmEnrollmentIds.length === 0) return { ok: true, datos: new Map() };
  if (crmEnrollmentIds.length > MAX_COMMERCE_BATCH) {
    return { ok: false, error: `Finance admite como máximo ${MAX_COMMERCE_BATCH} inscripciones por consulta.` };
  }
  const respuesta = await authedCall<unknown>("getCrmEnrollmentCommerceStates", { crmEnrollmentIds: [...crmEnrollmentIds] });
  const interpretado = interpretar(respuesta as { success?: boolean; error?: string; data?: unknown }, z.array(commerceStateSchema));
  if (!interpretado.ok) return interpretado;
  return { ok: true, datos: new Map(interpretado.datos.map((estado) => [estado.crmEnrollmentId, estado])) };
}

export async function markCrmCourseCompleted(input: {
  crmEnrollmentId: string;
  completionStatus: string;
  source: string;
}): Promise<ResultadoFinance<{ registrado: boolean }>> {
  const respuesta = await authedCall<unknown>("markCrmCourseCompleted", { ...input });
  // Finance no devuelve cuerpo util aqui: basta con que confirme el exito, asi
  // que solo se traduce el `success` a un booleano explicito.
  const sobre = respuesta as { success?: boolean; error?: string };
  return sobre?.success
    ? { ok: true, datos: { registrado: true } }
    : { ok: false, error: (sobre?.error ?? "Finance rechazó la solicitud.").slice(0, 300) };
}

/** Divide en lotes del tamaño que admite Finance. */
export function enLotes<T>(elementos: readonly T[], tamano = MAX_COMMERCE_BATCH): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < elementos.length; i += tamano) lotes.push(elementos.slice(i, i + tamano));
  return lotes;
}
