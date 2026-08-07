import { prisma } from "@/lib/db";
import { isAllowedMediaSource, mediaContentType, verifySignedMediaToken } from "@/lib/media/signed-media";
import { resolveTikTokConfig } from "@/lib/social/tiktok/config";

export const dynamic = "force-dynamic";

/**
 * Sirve el vídeo de una publicación para que TikTok lo descargue con
 * PULL_FROM_URL, bajo un dominio que sí controlamos y podemos verificar.
 *
 * Deliberadamente NO exige sesión: TikTok descarga desde sus servidores, sin
 * cookies. La autorización la aporta la firma HMAC del enlace, con caducidad.
 *
 * Tampoco redirige al almacenamiento: un 302 haría que TikTok viera el dominio
 * de Vercel Blob, que no está verificado, y la descarga fallaría.
 */
function deny(status: number, message: string) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

async function serve(request: Request, id: string, includeBody: boolean) {
  const config = resolveTikTokConfig();
  if (!config.stateSecret) return deny(503, "Integración no configurada.");

  const token = new URL(request.url).searchParams.get("token");
  const verification = verifySignedMediaToken(id, token, config.stateSecret);
  // Un mismo mensaje para firma inválida y caducada: distinguirlos ayudaría a
  // sondear identificadores.
  if (!verification.ok) return deny(403, "Enlace no válido o caducado.");

  const post = await prisma.socialPost.findUnique({ where: { id }, select: { mediaUrl: true } });
  if (!post?.mediaUrl) return deny(404, "No encontrado.");

  // Lista blanca de origen: sin ella, cualquier URL guardada en mediaUrl
  // convertiría este endpoint en un proxy abierto hacia la red interna.
  if (!isAllowedMediaSource(post.mediaUrl)) return deny(422, "Origen de archivo no permitido.");
  const contentType = mediaContentType(post.mediaUrl);
  if (!contentType) return deny(422, "Formato de archivo no admitido.");

  const range = request.headers.get("range");
  const upstream = await fetch(post.mediaUrl, {
    method: includeBody ? "GET" : "HEAD",
    headers: range ? { Range: range } : undefined,
    redirect: "error", // Un redirect del origen podría sacarnos de la lista blanca.
    cache: "no-store",
  }).catch(() => null);
  if (!upstream?.ok) return deny(502, "No se pudo leer el archivo.");

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=0, no-store",
    "X-Robots-Tag": "noindex",
    "Accept-Ranges": "bytes",
  });
  // TikTok necesita el tamaño exacto para planificar la descarga.
  for (const header of ["content-length", "content-range"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  return new Response(includeBody ? upstream.body : null, { status: upstream.status, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serve(request, (await params).id, true);
}

/** TikTok consulta HEAD antes de descargar para conocer tamaño y tipo. */
export async function HEAD(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serve(request, (await params).id, false);
}
