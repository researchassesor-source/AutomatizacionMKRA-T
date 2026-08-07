import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { isAllowedMediaSource } from "@/lib/media/signed-media";
import { getUsableAccessToken } from "@/lib/social/tiktok/account";
import { resolveTikTokConfig } from "@/lib/social/tiktok/config";
import {
  describePublishStatus,
  fetchPublishStatus,
  initDraftUpload,
  isTerminalStatus,
} from "@/lib/social/tiktok/publish";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  postId: z.string().trim().min(1, "Falta la publicación."),
  accountId: z.string().trim().min(1, "Falta la cuenta de TikTok."),
  /** El consentimiento no puede darse por supuesto ni marcarse por defecto. */
  consentAccepted: z.literal(true, {
    errorMap: () => ({ message: "Debes aceptar la Confirmación de uso de música de TikTok antes de enviar el vídeo." }),
  }),
});

/**
 * Envía un vídeo a la bandeja de TikTok como BORRADOR.
 *
 * No publica: la persona termina y publica desde la app de TikTok. Es el flujo
 * que solo necesita `video.upload` y que no exige que la cuenta esté en
 * privado, a diferencia de Direct Post con un cliente sin auditar.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }

  const config = resolveTikTokConfig();
  if (config.reason) return NextResponse.json({ error: config.reason }, { status: 422 });

  const post = await prisma.socialPost.findUnique({
    where: { id: parsed.data.postId },
    select: { id: true, mediaUrl: true, status: true, publishId: true, accountId: true },
  });
  if (!post) return NextResponse.json({ error: "No se encontró la publicación." }, { status: 404 });
  // Un registro que ya tiene publish_id nunca se reenvía: es la barrera contra
  // el doble clic y contra una repetición del proceso.
  if (post.publishId) {
    return NextResponse.json(
      { error: "Este vídeo ya se envió a TikTok. Consulta su estado en lugar de reenviarlo.", publishId: post.publishId },
      { status: 409 },
    );
  }
  if (!post.mediaUrl) return NextResponse.json({ error: "La publicación no tiene un vídeo asociado." }, { status: 422 });
  if (!isAllowedMediaSource(post.mediaUrl)) {
    return NextResponse.json({ error: "El vídeo no está en el almacenamiento del CRM." }, { status: 422 });
  }

  const token = await getUsableAccessToken(parsed.data.accountId, config);
  if (!token.ok) {
    return NextResponse.json(
      { error: token.error, errorCode: token.errorCode, reauthRequired: Boolean(token.reauthRequired) },
      { status: token.reauthRequired ? 409 : 502 },
    );
  }

  // Reclamo atómico: solo una petición puede pasar de aquí para el mismo
  // registro, incluso con dos clics simultáneos.
  const claimed = await prisma.socialPost.updateMany({
    where: { id: post.id, publishId: null, status: { in: ["BORRADOR", "PROGRAMADO", "FALLIDO"] } },
    data: { status: "PUBLICANDO", publishStartedAt: new Date(), error: null, errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ error: "El vídeo ya está siendo enviado a TikTok." }, { status: 409 });
  }

  // El archivo se descarga para conocer su tamaño exacto: FILE_UPLOAD exige
  // declarar video_size y chunk_size antes de transferir.
  const media = await fetch(post.mediaUrl, { cache: "no-store" }).catch(() => null);
  if (!media?.ok) {
    await failPost(post.id, "MEDIA_UNREADABLE", "No se pudo leer el vídeo del almacenamiento.");
    return NextResponse.json({ error: "No se pudo leer el vídeo del almacenamiento." }, { status: 502 });
  }
  const bytes = Buffer.from(await media.arrayBuffer());

  const init = await initDraftUpload(token.accessToken, {
    source: "FILE_UPLOAD",
    videoSize: bytes.byteLength,
    chunkSize: bytes.byteLength,
    totalChunkCount: 1,
  });
  if (!init.ok) {
    await failPost(post.id, init.errorCode, init.error);
    return NextResponse.json({ error: init.error, errorCode: init.errorCode }, { status: 502 });
  }

  if (init.data.uploadUrl) {
    const uploaded = await fetch(init.data.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.byteLength),
        // TikTok exige el rango completo incluso con un solo fragmento.
        "Content-Range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
      },
      body: new Uint8Array(bytes),
    }).catch(() => null);
    if (!uploaded?.ok) {
      await failPost(post.id, "UPLOAD_FAILED", "TikTok no aceptó la transferencia del vídeo.");
      return NextResponse.json({ error: "TikTok no aceptó la transferencia del vídeo." }, { status: 502 });
    }
  }

  // ACEPTADO, no PUBLICADO: TikTok recibió el vídeo, pero la publicación la
  // termina la persona desde la app.
  await prisma.socialPost.update({
    where: { id: post.id },
    data: {
      status: "ACEPTADO",
      publishId: init.data.publishId,
      providerStatus: "PROCESSING_UPLOAD",
      publishStartedAt: null,
      providerResponse: { flow: "inbox_draft", publishIdReceived: true, bytes: bytes.byteLength },
    },
  });
  await writeAudit({
    session: auth.session,
    action: "TIKTOK_DRAFT_UPLOADED",
    entityType: "SocialPost",
    entityId: post.id,
    metadata: { publishIdReceived: true, bytes: bytes.byteLength, mode: config.mode, consent: true },
  });

  return NextResponse.json({
    ok: true,
    publishId: init.data.publishId,
    status: "PROCESSING_UPLOAD",
    message: "Vídeo enviado a TikTok como borrador. Termina la publicación desde la notificación en la aplicación de TikTok.",
  });
}

async function failPost(postId: string, code: string, message: string) {
  await prisma.socialPost.update({
    where: { id: postId },
    data: {
      status: "FALLIDO",
      publishStartedAt: null,
      retryCount: { increment: 1 },
      errorCode: code.slice(0, 120),
      errorMessage: message.slice(0, 500),
      error: message.slice(0, 500),
    },
  });
}

/** Consulta el estado real en TikTok. Un HTTP 200 no basta para dar por buena una subida. */
export async function GET(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const postId = url.searchParams.get("postId");
  const accountId = url.searchParams.get("accountId");
  if (!postId || !accountId) return NextResponse.json({ error: "Faltan parámetros." }, { status: 422 });

  const post = await prisma.socialPost.findUnique({ where: { id: postId }, select: { publishId: true, providerStatus: true } });
  if (!post?.publishId) return NextResponse.json({ error: "Este vídeo todavía no se envió a TikTok." }, { status: 404 });

  const config = resolveTikTokConfig();
  const token = await getUsableAccessToken(accountId, config);
  if (!token.ok) return NextResponse.json({ error: token.error, errorCode: token.errorCode }, { status: 502 });

  const status = await fetchPublishStatus(token.accessToken, post.publishId);
  if (!status.ok) return NextResponse.json({ error: status.error, errorCode: status.errorCode }, { status: 502 });

  const terminal = isTerminalStatus(status.data.status);
  const failed = status.data.status === "FAILED";
  await prisma.socialPost.update({
    where: { id: postId },
    data: {
      providerStatus: status.data.status,
      // Solo se marca publicado si TikTok devuelve un identificador público
      // verificable; el borrador queda en ACEPTADO hasta que la persona lo
      // publique desde la aplicación.
      ...(failed
        ? { status: "FALLIDO", errorCode: status.data.failReason?.slice(0, 120) ?? "FAILED", errorMessage: status.data.failReason ?? "TikTok no pudo procesar el vídeo." }
        : status.data.publiclyAvailablePostId
          ? { status: "PUBLICADO", publishedAt: new Date(), externalPostId: status.data.publiclyAvailablePostId }
          : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    publishId: post.publishId,
    status: status.data.status,
    terminal,
    description: describePublishStatus(status.data.status),
    failReason: status.data.failReason,
    externalPostId: status.data.publiclyAvailablePostId,
  });
}
