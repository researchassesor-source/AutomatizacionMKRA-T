import { hasSendCredentials, resolveWhatsAppConfig } from "@/lib/whatsapp/config";

/**
 * Proxy de descarga para multimedia entrante de WhatsApp.
 *
 * Meta lo documenta en dos saltos: primero `GET /{media-id}` (con el mismo
 * token de envio) devuelve una URL temporal de descarga que expira en 5
 * minutos; despues esa URL se descarga, tambien con el token porque Meta lo
 * exige otra vez. No hay tercer salto ni almacenamiento propio: cada vista
 * del panel repite el flujo completo contra Meta.
 *
 * Este modulo no toca la base de datos ni conoce InboundMessage: recibe un
 * media_id ya resuelto por quien llama y solo sabe hablar con Meta.
 */

const GRAPH_METADATA_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * 25 MB cubre imagen/audio/documento tipicos de un chat de asesoria sin dejar
 * la ruta abierta a un archivo arbitrariamente grande.
 */
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Hosts reales de descarga de medios de Meta (CDN de la Graph API). Cualquier
 * URL fuera de esta lista -incluida una redireccion- se rechaza: la URL
 * temporal que devuelve Meta nunca se sigue a ciegas.
 */
const ALLOWED_MEDIA_HOSTS = [/(^|\.)fbsbx\.com$/i, /(^|\.)fbcdn\.net$/i];

export type MediaProxyErrorCode =
  | "NOT_CONFIGURED"
  | "UPSTREAM_ERROR"
  | "UNTRUSTED_HOST"
  | "TOO_LARGE"
  | "TIMEOUT"
  | "REDIRECT_BLOCKED";

export type MediaProxyResult =
  | { ok: true; body: ReadableStream<Uint8Array>; contentType: string; contentLength: number | null }
  | { ok: false; error: MediaProxyErrorCode };

function esHostDeMediaPermitido(url: string): boolean {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "https:" && ALLOWED_MEDIA_HOSTS.some((patron) => patron.test(hostname));
  } catch {
    return false;
  }
}

function esRespuestaDeRedireccion(res: Response): boolean {
  // undici (fetch de Node/Next.js) devuelve el status real con redirect:
  // "manual" en vez del opaqueredirect del spec, pero se cubren ambos casos
  // por si el runtime cambia: cualquiera de las dos señales basta para frenar.
  return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
}

/**
 * Envuelve el stream de descarga y lo corta si supera el tope, incluso
 * cuando Meta no declara Content-Length por adelantado.
 */
function limitarStream(origen: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  const reader = origen.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let resultado: ReadableStreamReadResult<Uint8Array>;
      try {
        resultado = await reader.read();
      } catch (error) {
        controller.error(error);
        return;
      }
      if (resultado.done) {
        controller.close();
        return;
      }
      total += resultado.value.byteLength;
      if (total > maxBytes) {
        controller.error(new Error("MEDIA_TOO_LARGE"));
        await reader.cancel().catch(() => undefined);
        return;
      }
      controller.enqueue(resultado.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/**
 * Descarga el archivo detras de un media_id de Meta ya resuelto.
 *
 * Nunca registra el token, la URL temporal ni el contenido: solo codigos de
 * error clasificados. Falla cerrado ante cualquier duda (host no verificado,
 * timeout, tamaño desconocido que se dispara, redireccion).
 */
export async function descargarMediaDeWhatsApp(mediaId: string): Promise<MediaProxyResult> {
  const config = resolveWhatsAppConfig();
  if (!hasSendCredentials(config)) return { ok: false, error: "NOT_CONFIGURED" };

  let metadata: { url?: unknown; mime_type?: unknown; file_size?: unknown };
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(GRAPH_METADATA_TIMEOUT_MS),
    });
    if (!metaRes.ok) return { ok: false, error: "UPSTREAM_ERROR" };
    metadata = await metaRes.json();
  } catch {
    return { ok: false, error: "TIMEOUT" };
  }

  const mediaUrl = typeof metadata.url === "string" ? metadata.url : null;
  if (!mediaUrl || !esHostDeMediaPermitido(mediaUrl)) return { ok: false, error: "UNTRUSTED_HOST" };

  const tamanoDeclarado = typeof metadata.file_size === "number" ? metadata.file_size : null;
  if (tamanoDeclarado !== null && tamanoDeclarado > MEDIA_MAX_BYTES) return { ok: false, error: "TOO_LARGE" };

  let descarga: Response;
  try {
    descarga = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "TIMEOUT" };
  }

  if (esRespuestaDeRedireccion(descarga)) return { ok: false, error: "REDIRECT_BLOCKED" };
  if (!descarga.ok || !descarga.body) return { ok: false, error: "UPSTREAM_ERROR" };

  const contentLengthHeader = descarga.headers.get("content-length");
  const contentLength = contentLengthHeader && Number.isFinite(Number(contentLengthHeader)) ? Number(contentLengthHeader) : null;
  if (contentLength !== null && contentLength > MEDIA_MAX_BYTES) return { ok: false, error: "TOO_LARGE" };

  const contentType = typeof metadata.mime_type === "string" && metadata.mime_type
    ? metadata.mime_type
    : (descarga.headers.get("content-type") ?? "application/octet-stream");

  return {
    ok: true,
    body: limitarStream(descarga.body, MEDIA_MAX_BYTES),
    contentType,
    contentLength,
  };
}
