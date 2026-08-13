import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireRole } from "@/lib/auth/authorization";
import { isPreviewDeployment } from "@/lib/runtime-environment";
import { CONTENIDO } from "@/lib/auth/roles";
import { MAX_SOCIAL_VIDEO_BYTES, SOCIAL_VIDEO_MIME_TYPES } from "@/lib/social/media";

export const dynamic = "force-dynamic";

// Autoriza subidas directas del navegador a Vercel Blob (para archivos
// grandes, como videos). La peticion del navegador llega con la cookie de
// admin, asi que el middleware ya la protege.
export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  if (isPreviewDeployment()) {
    return NextResponse.json(
      { error: "Las cargas a almacenamiento externo están bloqueadas en Preview." },
      { status: 409 },
    );
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "Almacenamiento no configurado (conecta Vercel Blob)." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [...SOCIAL_VIDEO_MIME_TYPES],
        maximumSizeInBytes: MAX_SOCIAL_VIDEO_BYTES,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // Best-effort; no requerimos accion al completar.
      },
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "No se pudo autorizar la carga." }, { status: 400 });
  }
}
