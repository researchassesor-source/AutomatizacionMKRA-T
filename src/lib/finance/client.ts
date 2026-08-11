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

/** URL administrativa. Si Finance no publica una ruta por id, abre su app. */
export function financeEnrollmentUrl(inscripcionId: string): string {
  const template = process.env.FINANCE_ENROLLMENT_URL_TEMPLATE?.trim();
  if (template) return template.replace("{id}", encodeURIComponent(inscripcionId));
  return financeAppUrl();
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
  const response = await fetch(apiUrl, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload: body }),
  });
  if (!response.ok) throw new Error(`Finance respondió ${response.status}.`);
  return (await response.json()) as FinanceResponse<T>;
}

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

async function authedCall<T>(action: string, params: Record<string, unknown>) {
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

export async function createInscripcion(input: FinanceEnrollmentInput): Promise<{ id: string }> {
  const response = await authedCall<unknown>("addInscripcion", {
    inscripcion: buildFinanceInscripcionPayload(input),
  });
  if (!response.success) throw new Error("Finance no pudo crear la inscripción.");
  const data = response.data as { id?: string; ID?: string } | undefined;
  const id = response.id ?? data?.id ?? data?.ID;
  if (!id) throw new Error("Finance no devolvió una referencia.");
  return { id };
}

export async function verifyCertificate(id: string) {
  const response = await rawCall<Record<string, unknown>>("verificarCertificado", { id });
  return { valido: response.valido === true, data: response.data ?? null };
}

// No existe una función de emisión en este cliente por diseño. El CRM solo
// crea inscripciones y consulta el último estado conocido por Finance.
