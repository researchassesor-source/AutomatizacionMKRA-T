import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireRole } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

// Autoriza subidas directas del navegador a Vercel Blob (para archivos
// grandes, como videos). La peticion del navegador llega con la cookie de
// admin, asi que el middleware ya la protege.
export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN", "MARKETING"]);
  if (auth.error) return auth.error;
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
        allowedContentTypes: [
          "video/mp4",
          "video/quicktime",
          "video/webm",
        ],
        maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
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
