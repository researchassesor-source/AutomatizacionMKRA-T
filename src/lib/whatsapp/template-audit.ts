import { WHATSAPP_TEMPLATES, type WhatsAppTemplateSpec } from "./templates";

/**
 * Compara el catalogo de plantillas del codigo con lo registrado en Meta.
 *
 * Meta es un contrato externo: se edita desde su panel, fuera del repositorio y
 * sin avisar. Cuando deja de coincidir, el unico sintoma es un 132000 en el
 * momento del envio, que es el peor momento para enterarse. Esto lo convierte
 * en una comprobacion que se puede hacer antes, y sin contactar a nadie.
 *
 * Todo aqui es de solo lectura: un GET a `message_templates` y comparaciones en
 * memoria. No envia mensajes, no crea plantillas y no edita Meta.
 */

/** Forma minima de lo que devuelve Graph: solo los campos que se comparan. */
export type MetaTemplate = {
  name: string;
  language: string;
  status: string;
  category?: string;
  parameter_format?: string;
  components?: Array<{ type: string; text?: string; buttons?: Array<{ url?: string }> }>;
};

export type Semaforo = "GREEN" | "YELLOW" | "RED";

export type ParamCounts = { bodyParams: number; headerParams: number; buttonParams: number };

export type FilaAuditoria = {
  key: string;
  name: string;
  language: string;
  metaStatus: string | null;
  category: string | null;
  parameterFormat: string | null;
  codigo: ParamCounts;
  meta: ParamCounts | null;
  result: Semaforo;
  detail: string;
};

/**
 * Estados de Meta que no impiden enviar manana pero tampoco rompen el contrato.
 * Con el contrato correcto, estos son un "todavia no", no un "no coincide".
 */
const ESTADOS_TOLERABLES = new Set(["PENDING", "IN_APPEAL", "PENDING_DELETION"]);

/**
 * Variables de un componente de Meta.
 *
 * Se separan las posicionales de las nombradas porque son formatos
 * incompatibles: el CRM envia posicionales, y una plantilla migrada a
 * nombradas rechaza el envio entero aunque el numero de variables coincida.
 */
export function contarVariables(texto: string | undefined) {
  const contenido = texto ?? "";
  const posicionales = new Set([...contenido.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
  const nombradas = new Set([...contenido.matchAll(/\{\{([a-zA-Z_][\w]*)\}\}/g)].map((m) => m[1]));
  return { posicionales: posicionales.size, nombradas: nombradas.size };
}

function contarDeMeta(remota: MetaTemplate): ParamCounts & { nombradas: number } {
  const componentes = remota.components ?? [];
  const body = componentes.find((c) => c.type === "BODY");
  const header = componentes.find((c) => c.type === "HEADER");
  const botones = componentes.find((c) => c.type === "BUTTONS");
  const cuerpo = contarVariables(body?.text);
  const cabecera = contarVariables(header?.text);
  return {
    bodyParams: cuerpo.posicionales,
    headerParams: cabecera.posicionales + cabecera.nombradas,
    buttonParams: (botones?.buttons ?? []).filter((b) => typeof b.url === "string" && b.url.includes("{{")).length,
    nombradas: cuerpo.nombradas,
  };
}

function contarDelCodigo(spec: WhatsAppTemplateSpec): ParamCounts {
  // El CRM nunca manda HEADER: ninguna plantilla del plan lo declara.
  return { bodyParams: spec.bodyVars.length, headerParams: 0, buttonParams: spec.urlVar ? 1 : 0 };
}

/**
 * Compara una plantilla del catalogo con lo que Meta tiene registrado.
 *
 * `remotas` es la lista completa devuelta por Meta: hace falta entera para
 * poder distinguir "no existe" de "existe en otro idioma", que se arreglan de
 * formas distintas.
 */
export function compararPlantilla(key: string, spec: WhatsAppTemplateSpec, remotas: MetaTemplate[]): FilaAuditoria {
  const codigo = contarDelCodigo(spec);
  const base = { key, name: spec.name, language: spec.language, codigo };
  const remota = remotas.find((t) => t.name === spec.name && t.language === spec.language);

  if (!remota) {
    const otros = remotas.filter((t) => t.name === spec.name).map((t) => t.language);
    return {
      ...base,
      metaStatus: null,
      category: null,
      parameterFormat: null,
      meta: null,
      result: "RED",
      detail: otros.length
        ? `Existe en Meta en ${otros.join(", ")}, pero no en "${spec.language}".`
        : "No existe en Meta.",
    };
  }

  const conteo = contarDeMeta(remota);
  const meta: ParamCounts = {
    bodyParams: conteo.bodyParams,
    headerParams: conteo.headerParams,
    buttonParams: conteo.buttonParams,
  };
  const incompatibles: string[] = [];

  if (conteo.nombradas > 0 || (remota.parameter_format && remota.parameter_format.toUpperCase() !== "POSITIONAL")) {
    incompatibles.push("Meta usa parámetros con nombre y el CRM envía posicionales.");
  }
  if (meta.bodyParams !== codigo.bodyParams) {
    incompatibles.push(`BODY: Meta espera ${meta.bodyParams} y el CRM envía ${codigo.bodyParams}.`);
  }
  if (meta.headerParams !== codigo.headerParams) {
    incompatibles.push(`HEADER: Meta espera ${meta.headerParams} variable(s) y el CRM no envía cabecera.`);
  }
  if (meta.buttonParams !== codigo.buttonParams) {
    incompatibles.push(`BUTTON: Meta espera ${meta.buttonParams} y el CRM envía ${codigo.buttonParams}.`);
  }

  const comun = {
    ...base,
    metaStatus: remota.status,
    category: remota.category ?? null,
    parameterFormat: remota.parameter_format ?? null,
    meta,
  };

  if (incompatibles.length > 0) return { ...comun, result: "RED", detail: incompatibles.join(" ") };
  if (remota.status === "APPROVED") return { ...comun, result: "GREEN", detail: "El contrato coincide con Meta." };
  if (ESTADOS_TOLERABLES.has(remota.status)) {
    return { ...comun, result: "YELLOW", detail: `El contrato coincide, pero Meta la tiene en estado ${remota.status}.` };
  }
  // Rechazada, deshabilitada o pausada: el contrato coincide pero un envio real
  // fallaria igual, asi que no puede quedarse en un aviso menor.
  return {
    ...comun,
    result: "RED",
    detail: `El contrato coincide, pero Meta la tiene en estado ${remota.status} y rechazaría el envío.`,
  };
}

export type ResumenAuditoria = {
  green: number;
  yellow: number;
  red: number;
  total: number;
  plantillas: FilaAuditoria[];
};

export function compararCatalogo(remotas: MetaTemplate[]): ResumenAuditoria {
  const plantillas = Object.entries(WHATSAPP_TEMPLATES).map(([key, spec]) => compararPlantilla(key, spec, remotas));
  const cuenta = (estado: Semaforo) => plantillas.filter((fila) => fila.result === estado).length;
  return { green: cuenta("GREEN"), yellow: cuenta("YELLOW"), red: cuenta("RED"), total: plantillas.length, plantillas };
}

export type ConfigAuditoria = { accessToken: string; wabaId: string; graphVersion: string };

export type ResolucionConfig =
  | { ok: true; config: ConfigAuditoria }
  | { ok: false; errorCode: string; error: string };

/** Nunca devuelve el token: solo dice si falta, y cual. */
export function resolverConfigAuditoria(env: Record<string, string | undefined> = process.env): ResolucionConfig {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const wabaId = env.WHATSAPP_WABA_ID?.trim();
  if (!accessToken) {
    return { ok: false, errorCode: "WHATSAPP_TOKEN_MISSING", error: "Falta WHATSAPP_ACCESS_TOKEN en el entorno." };
  }
  if (!wabaId) {
    return {
      ok: false,
      errorCode: "WHATSAPP_WABA_MISSING",
      // No es el identificador del numero: las plantillas cuelgan de la cuenta.
      error:
        "Falta WHATSAPP_WABA_ID en el entorno. No es el identificador del número: las plantillas cuelgan de la cuenta de WhatsApp Business.",
    };
  }
  return { ok: true, config: { accessToken, wabaId, graphVersion: env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v25.0" } };
}

export type DescargaMeta =
  | { ok: true; plantillas: MetaTemplate[] }
  | { ok: false; errorCode: string; error: string };

/**
 * Descarga todas las plantillas de la cuenta, siguiendo la paginacion.
 *
 * El token viaja en la cabecera y nunca en la URL: una URL acaba escrita en
 * registros de acceso y en mensajes de error, y ahi deja de ser un secreto.
 */
export async function descargarPlantillasDeMeta(
  config: ConfigAuditoria,
  fetchImpl: typeof fetch = fetch,
): Promise<DescargaMeta> {
  const campos = "name,language,status,category,components,parameter_format";
  let url: string | null = `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.wabaId)}/message_templates?limit=100&fields=${campos}`;
  const plantillas: MetaTemplate[] = [];

  while (url) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${config.accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { ok: false, errorCode: "META_UNREACHABLE", error: "No se pudo contactar con Meta para leer las plantillas." };
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: MetaTemplate[]; paging?: { next?: string }; error?: { code?: number; message?: string } }
      | null;
    if (!res.ok) {
      const code = json?.error?.code ?? res.status;
      // Se devuelve el mensaje de Meta, que nombra el permiso o el id que falla,
      // pero nunca la peticion: la cabecera lleva el token.
      return { ok: false, errorCode: `META_${code}`, error: json?.error?.message ?? `Meta respondió ${res.status}.` };
    }
    plantillas.push(...(json?.data ?? []));
    url = json?.paging?.next ?? null;
  }
  return { ok: true, plantillas };
}

export type ResultadoAuditoria = ({ ok: true } & ResumenAuditoria) | { ok: false; errorCode: string; error: string };

/** Punto de entrada unico: lo usan el endpoint del panel y el script de consola. */
export async function auditarPlantillasConMeta(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoAuditoria> {
  const config = resolverConfigAuditoria(env);
  if (!config.ok) return config;
  const descarga = await descargarPlantillasDeMeta(config.config, fetchImpl);
  if (!descarga.ok) return descarga;
  return { ok: true, ...compararCatalogo(descarga.plantillas) };
}
