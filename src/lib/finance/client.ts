// Cliente para integrar con ra-training-finance (la fuente de verdad de
// certificados y avales). MKRA-T no emite certificados: entrega los leads
// convertidos como inscripciones y enlaza a la verificacion de finance.
//
// Protocolo: la API de finance (Apps Script, opcionalmente tras el proxy de
// Vercel) recibe un unico parametro `payload` con JSON { action, ...params }.
//
// Config por entorno (ver .env.example):
//   FINANCE_API_URL   endpoint que acepta ?payload=  (proxy /api/proxy o GAS /exec)
//   FINANCE_APP_URL   base del sitio de finance, para construir enlaces de verificacion
//   FINANCE_USER      usuario de servicio (rol "vendedor" o "admin")
//   FINANCE_PASS      contrasena del usuario de servicio
//   FINANCE_SERVICE_NAME  nombre del servicio a inscribir (def. "Certificado LMS")

type FinanceResponse<T = unknown> = {
  success: boolean;
  error?: string;
  token?: string;
  valido?: boolean;
  data?: T;
  id?: string;
};

export function isFinanceConfigured(): boolean {
  return Boolean(
    process.env.FINANCE_API_URL &&
      process.env.FINANCE_USER &&
      process.env.FINANCE_PASS,
  );
}

export function financeVerificationUrl(inscripcionId: string): string {
  const base = (process.env.FINANCE_APP_URL ?? "").replace(/\/$/, "");
  return `${base}/verificar/${inscripcionId}`;
}

async function rawCall<T>(
  action: string,
  params: Record<string, unknown>,
  token?: string,
): Promise<FinanceResponse<T>> {
  const apiUrl = process.env.FINANCE_API_URL;
  if (!apiUrl) throw new Error("FINANCE_API_URL no configurada");

  const body: Record<string, unknown> = { action, ...params };
  if (token) body.token = token;

  const url = `${apiUrl}?payload=${encodeURIComponent(JSON.stringify(body))}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`finance HTTP ${res.status}`);
  return (await res.json()) as FinanceResponse<T>;
}

// --- Token de servicio con cache en memoria (se renueva al expirar) ---
let cachedToken: { value: string; obtainedAt: number } | null = null;
// Las sesiones de finance expiran en 24h; renovamos con margen a las 20h.
const TOKEN_TTL_MS = 20 * 60 * 60 * 1000;

async function getServiceToken(forceRenew = false): Promise<string> {
  if (
    !forceRenew &&
    cachedToken &&
    Date.now() - cachedToken.obtainedAt < TOKEN_TTL_MS
  ) {
    return cachedToken.value;
  }
  const res = await rawCall<never>("login", {
    username: process.env.FINANCE_USER,
    password: process.env.FINANCE_PASS,
  });
  if (!res.success || !res.token) {
    throw new Error(res.error ?? "login en finance fallo");
  }
  cachedToken = { value: res.token, obtainedAt: Date.now() };
  return res.token;
}

/** Llama una accion autenticada; reintenta una vez si el token expiro. */
async function authedCall<T>(
  action: string,
  params: Record<string, unknown>,
): Promise<FinanceResponse<T>> {
  const token = await getServiceToken();
  let res = await rawCall<T>(action, params, token);
  if (!res.success && /token|sesi|denegado|auth/i.test(res.error ?? "")) {
    const fresh = await getServiceToken(true);
    res = await rawCall<T>(action, params, fresh);
  }
  return res;
}

export type InscripcionInput = {
  clienteNombre: string;
  clienteEmail?: string;
  clienteTelefono?: string;
  servicioNombre?: string;
  modalidad?: string;
  monto?: number;
  notas?: string;
};

/**
 * Crea una inscripcion en finance (handoff del lead). Devuelve el ID de la
 * inscripcion (INS_...), que es tambien el codigo de verificacion del
 * certificado una vez que finance lo emita.
 */
export async function createInscripcion(
  input: InscripcionInput,
): Promise<{ id: string }> {
  const inscripcion = {
    servicioNombre:
      input.servicioNombre ?? process.env.FINANCE_SERVICE_NAME ?? "Certificado LMS",
    modalidad: input.modalidad ?? "Virtual",
    monto: input.monto ?? 0,
    clienteNombre: input.clienteNombre,
    clienteEmail: input.clienteEmail ?? "",
    clienteTelefono: input.clienteTelefono ?? "",
    notas: input.notas ?? "",
  };

  const res = await authedCall<unknown>("addInscripcion", { inscripcion });
  if (!res.success) throw new Error(res.error ?? "addInscripcion fallo");

  // La respuesta puede traer el id en distintos campos segun la version del backend.
  const id =
    res.id ??
    (res.data as { id?: string; ID?: string } | undefined)?.id ??
    (res.data as { ID?: string } | undefined)?.ID;
  if (!id) throw new Error("finance no devolvio el ID de la inscripcion");
  return { id };
}

/**
 * ¿Emision automatica del certificado tras el handoff?
 * Por defecto NO (manual): finance emite el certificado por su flujo normal.
 * Actívalo con FINANCE_AUTO_EMIT=true (util para cursos gratuitos de enganche).
 */
export function isAutoEmitEnabled(): boolean {
  return /^(1|true|yes|on|si)$/i.test(process.env.FINANCE_AUTO_EMIT ?? "");
}

/**
 * Marca el certificado de una inscripcion como "emitido" en finance.
 * Envia solo los campos necesarios; el resto queda intacto (updateRow ignora
 * los undefined). monto:0 porque son cursos gratuitos.
 */
export async function emitCertificate(inscripcionId: string): Promise<void> {
  const res = await authedCall<unknown>("updateInscripcion", {
    id: inscripcionId,
    inscripcion: { estadoCertificado: "emitido", monto: 0 },
  });
  if (!res.success) {
    throw new Error(res.error ?? "updateInscripcion (emitir) fallo");
  }
}

/** Verificacion publica (sin token) de un certificado por su ID de inscripcion. */
export async function verifyCertificate(id: string) {
  const res = await rawCall<Record<string, unknown>>("verificarCertificado", {
    id,
  });
  return { valido: res.valido === true, data: res.data ?? null };
}
