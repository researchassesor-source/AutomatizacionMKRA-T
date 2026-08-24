import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/authorization";
import { OPERACION } from "@/lib/auth/roles";
import { descargarMediaDeWhatsApp, type MediaProxyErrorCode } from "@/lib/whatsapp/media-proxy";

export const dynamic = "force-dynamic";

const TIPOS_MEDIA = new Set(["image", "audio", "video", "document", "sticker"]);

/**
 * image/audio/video/sticker son renderizables directamente por el navegador.
 * "document" queda como attachment: es el único tipo genérico (PDF, Word,
 * lo que sea), y forzar la descarga en vez de intentar mostrarlo evita que el
 * navegador intente interpretar un tipo de archivo inesperado.
 *
 * Esto solo afecta abrir la URL directo en una pestaña: un <img>/<video>/
 * <audio> como subrecurso siempre ignora Content-Disposition: attachment y
 * renderiza igual, así que no condiciona en nada el render del Bloque 3.
 */
const TIPOS_INLINE = new Set(["image", "audio", "video", "sticker"]);

const ESTADO_POR_ERROR: Record<MediaProxyErrorCode, number> = {
  NOT_CONFIGURED: 503,
  TOO_LARGE: 413,
  TIMEOUT: 504,
  UPSTREAM_ERROR: 502,
  UNTRUSTED_HOST: 502,
  REDIRECT_BLOCKED: 502,
};

/** Quita separadores de ruta y cualquier caracter fuera de un set seguro para un header. */
function sanitizarNombreArchivo(nombre: string | undefined, tipo: string): string {
  const limpio = (nombre ?? "").replace(/[\\/]/g, "_").replace(/[^\w.\-() ]/g, "_").trim();
  return limpio.slice(0, 120) || `whatsapp-${tipo}`;
}

/**
 * Descarga autenticada de un adjunto entrante de WhatsApp.
 *
 * `id` es SIEMPRE el id propio de InboundMessage, nunca el media_id de Meta:
 * el cliente no puede pedir un archivo por su referencia en Meta, solo por un
 * mensaje que ya le pertenece a una conversación visible en el panel. El
 * media_id real se resuelve aquí, en el servidor, a partir de ese mensaje.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, OPERACION);
  if (auth.error) return auth.error;

  const { id } = await params;
  const mensaje = await prisma.inboundMessage.findUnique({
    where: { id },
    select: { type: true, mediaMeta: true },
  });
  if (!mensaje) return NextResponse.json({ error: "No se encontró el mensaje." }, { status: 404 });
  if (!TIPOS_MEDIA.has(mensaje.type)) {
    return NextResponse.json({ error: "Ese mensaje no tiene un adjunto multimedia." }, { status: 422 });
  }

  const meta = mensaje.mediaMeta as Record<string, unknown> | null;
  const mediaId = typeof meta?.id === "string" ? meta.id : null;
  if (!mediaId) return NextResponse.json({ error: "El mensaje no tiene un archivo asociado." }, { status: 422 });

  const descarga = await descargarMediaDeWhatsApp(mediaId);
  if (!descarga.ok) {
    return NextResponse.json(
      { error: "No se pudo obtener el archivo desde WhatsApp.", errorCode: descarga.error },
      { status: ESTADO_POR_ERROR[descarga.error] },
    );
  }

  const nombreArchivo = sanitizarNombreArchivo(typeof meta?.filename === "string" ? meta.filename : undefined, mensaje.type);
  const disposicion = TIPOS_INLINE.has(mensaje.type) ? "inline" : "attachment";

  const headers = new Headers({
    "Content-Type": descarga.contentType,
    "Content-Disposition": `${disposicion}; filename="${nombreArchivo}"`,
    "X-Content-Type-Options": "nosniff",
    // Es contenido del contacto detrás de sesión: no debe quedar en un cache
    // compartido ni reutilizarse sin volver a pasar por requireRole.
    "Cache-Control": "private, no-store",
  });
  if (descarga.contentLength !== null) headers.set("Content-Length", String(descarga.contentLength));

  return new NextResponse(descarga.body, { status: 200, headers });
}
