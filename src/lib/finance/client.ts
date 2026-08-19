import { mustSimulateExternalIntegration } from "@/lib/runtime-environment";

type FinanceResponse<T = unknown> = {
  success: boolean;
  error?: string;
  token?: string;
  valido?: boolean;
  data?: T;
  id?: string;
};

export function isFinanceConfigured(): boolean {
  return Boolean(process.env.FINANCE_API_URL && process.env.FINANCE_USER && process.env.FINANCE_PASS);
}

export function isFinanceSimulation(): boolean {
  return mustSimulateExternalIntegration(process.env.FINANCE_MODE);
}

export function financeAppUrl(): string {
  return (process.env.FINANCE_APP_URL ?? "").replace(/\/$/, "");
}

export function financeVerificationUrl(inscripcionId: string): string {
  const base = financeAppUrl();
  return base ? `${base}/verificar/${encodeURIComponent(inscripcionId)}` : "";
}

/** URL administrativa que abre la inscripción exacta en Finance. */
export function financeEnrollmentUrl(inscripcionId: string): string {
  const template = process.env.FINANCE_ENROLLMENT_URL_TEMPLATE?.trim();
  if (template) return template.replace("{id}", encodeURIComponent(inscripcionId));
  const base = financeAppUrl();
  return base ? `${base}/inscripciones?open=${encodeURIComponent(inscripcionId)}` : "";
}

async function rawCall<T>(
  action: string,
  params: Record<string, unknown>,
  token?: string,
): Promise<FinanceResponse<T>> {
  if (isFinanceSimulation()) throw new Error("Finance está en modo de simulación.");
  const apiUrl = process.env.FINANCE_API_URL;
  if (!apiUrl) throw new Error("Finance no está configurado.");
  const body: Record<string, unknown> = { action, ...params };
  if (token) body.token = token;
  /**
   * Token de servicio del contrato comercial.
   *
   * Las acciones de CRMCompras esperan `serviceToken` con el valor de
   * `CRM_SERVICE_TOKEN`, mientras que el traspaso heredado se autentica con el
   * `token` de sesion que devuelve `login`. Se envian AMBOS cuando existen:
   * cada accion toma el que entiende y ninguna de las dos rutas se rompe. No
   * se registra en ningun sitio.
   */
  const serviceToken = process.env.CRM_SERVICE_TOKEN?.trim();
  if (serviceToken) body.serviceToken = serviceToken;
  // Sin plazo, una hoja de calculo lenta deja colgada la funcion hasta que la
  // plataforma la corta, y el cron pierde el resto del ciclo esperando.
  const response = await fetch(apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FINANCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Finance respondió ${response.status}.`);
  return (await response.json()) as FinanceResponse<T>;
}

/** Apps Script puede tardar; mas de esto es un fallo, no lentitud. */
const FINANCE_TIMEOUT_MS = 25_000;

let cachedToken: { value: string; obtainedAt: number } | null = null;
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000;

async function getServiceToken(forceRenew = false): Promise<string> {
  if (!forceRenew && cachedToken && Date.now() - cachedToken.obtainedAt < TOKEN_TTL_MS) {
    return cachedToken.value;
  }
  const response = await rawCall<never>("login", {
    username: process.env.FINANCE_USER,
    password: process.env.FINANCE_PASS,
  });
  if (!response.success || !response.token) throw new Error("Finance rechazó la autenticación.");
  cachedToken = { value: response.token, obtainedAt: Date.now() };
  return response.token;
}

/**
 * Llamada autenticada con renovacion de token.
 *
 * Se exporta para que el modulo comercial reutilice exactamente el mismo
 * transporte, token y reintento que el traspaso ya en produccion, en vez de
 * abrir un segundo camino que habria que mantener en paralelo.
 */
export async function authedCall<T>(action: string, params: Record<string, unknown>) {
  let response = await rawCall<T>(action, params, await getServiceToken());
  if (!response.success && /token|sesi|denegado|auth/i.test(response.error ?? "")) {
    response = await rawCall<T>(action, params, await getServiceToken(true));
  }
  return response;
}

export type FinanceEnrollmentInput = {
  crmEnrollmentId: string;
  crmContactId: string;
  crmCourseId: string;
  /**
   * Vínculo estable con el Servicio de Finance (Course.financeServiceId).
   * `null` cuando el curso todavía no está vinculado: Finance cae al
   * contrato heredado por nombre normalizado (servicioNombre).
   */
  financeServiceId: string | null;
  courseTitle: string;
  courseSlug: string;
  modality: string;
  startDate: string;
  endDate: string;
  timezone: string;
  participant: {
    firstName: string | null;
    lastName: string | null;
    fullName: string;
    email: string;
    phone: string | null;
    identification: null;
  };
  amount: number | null;
};

export function buildFinanceInscripcionPayload(input: FinanceEnrollmentInput) {
  return {
    crmEnrollmentId: input.crmEnrollmentId,
    crmContactId: input.crmContactId,
    crmCourseId: input.crmCourseId,
    // Ausente (no "") cuando el curso no está vinculado, para que Finance
    // pueda distinguir "sin vínculo" de "vínculo vacío" y caer al nombre.
    financeServiceId: input.financeServiceId ?? undefined,
    courseTitle: input.courseTitle,
    courseSlug: input.courseSlug,
    modality: input.modality,
    startDate: input.startDate,
    endDate: input.endDate,
    timezone: input.timezone,
    participant: input.participant,
    amount: input.amount,
    source: "CRM",
    // Compatibilidad con el receptor histórico mientras Finance adopta el
    // contrato con identificadores CRM e idempotencia por enrollment.
    servicioNombre: input.courseTitle,
    modalidad: input.modality,
    monto: input.amount,
    clienteNombre: input.participant.fullName,
    clienteEmail: input.participant.email,
    clienteTelefono: input.participant.phone ?? "",
    notas: `Inscripción CRM · ${input.crmEnrollmentId}`,
  };
};

/**
 * Errores funcionales que Finance devuelve en texto libre y que el CRM ya
 * reconoce. Cualquier otro texto se trata como desconocido: nunca se propaga
 * tal cual hacia la interfaz, para no filtrar detalles internos de Finance
 * (tokens, URLs, mensajes de Apps Script) a quien opera el CRM.
 */
const KNOWN_FINANCE_ERRORS: Record<string, string> = {
  "Servicio de Finance no configurado para este curso.": "FINANCE_SERVICE_NOT_CONFIGURED",
  "Finance rechazó la autenticación.": "FINANCE_AUTH_FAILED",
};

function classifyFinanceError(rawError: string | undefined): string {
  if (rawError && KNOWN_FINANCE_ERRORS[rawError]) return KNOWN_FINANCE_ERRORS[rawError];
  return "FINANCE_REQUEST_FAILED";
}

export async function createInscripcion(input: FinanceEnrollmentInput): Promise<{ id: string }> {
  let response: FinanceResponse<unknown>;
  try {
    response = await authedCall<unknown>("addInscripcion", {
      idempotencyKey: input.crmEnrollmentId,
      inscripcion: buildFinanceInscripcionPayload(input),
    });
  } catch (error) {
    // La autenticación (login) puede fallar antes de llegar a addInscripcion;
    // pasa por el mismo mapeo para que ambos caminos terminen en el mismo código.
    throw new Error(classifyFinanceError(error instanceof Error ? error.message : undefined));
  }
  if (!response.success) throw new Error(classifyFinanceError(response.error));
  const data = response.data as { id?: string; ID?: string } | undefined;
  const id = response.id ?? data?.id ?? data?.ID;
  if (!id) throw new Error("Finance no devolvió una referencia.");
  return { id };
}

export async function verifyCertificate(id: string) {
  const response = await rawCall<Record<string, unknown>>("verificarCertificado", { id });
  return { valido: response.valido === true, data: response.data ?? null };
}

export type FinanceService = { id: string; nombre: string; modalidad: string; activo: boolean };

/**
 * Servicios de Finance para el selector "Configurar Finance" (sección R del
 * release de estabilización).
 *
 * Solo lo mínimo útil para elegir: id, nombre y modalidad. Nunca se expone
 * nada de la fila cruda de la hoja de cálculo (tokens, montos, URLs
 * privadas) — la respuesta de Finance para `getServicios` puede traer
 * columnas internas que no le corresponden al CRM.
 */
export async function listActiveFinanceServices(): Promise<FinanceService[]> {
  let response: FinanceResponse<unknown>;
  try {
    response = await authedCall<unknown>("getServicios", {});
  } catch (error) {
    throw new Error(classifyFinanceError(error instanceof Error ? error.message : undefined));
  }
  if (!response.success) throw new Error(classifyFinanceError(response.error));
  const filas = Array.isArray(response.data) ? (response.data as Record<string, unknown>[]) : [];
  return filas
    .filter((fila) => esVerdadero(fila.Activo))
    .map((fila) => ({
      id: String(fila.ID ?? ""),
      nombre: String(fila.Nombre ?? ""),
      modalidad: String(fila.Modalidad ?? ""),
      activo: true,
    }))
    .filter((servicio) => servicio.id && servicio.nombre);
}

/** Espejo minimo de `esVerdadero` en Code.gs: la hoja guarda booleanos como texto. */
function esVerdadero(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const texto = String(value ?? "").trim().toLowerCase();
  return texto === "true" || texto === "verdadero" || texto === "sí" || texto === "si" || texto === "1";
}

// No existe una función de emisión en este cliente por diseño. El CRM solo
// crea inscripciones y consulta el último estado conocido por Finance.
