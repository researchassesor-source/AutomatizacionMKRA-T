import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { requireRole } from "@/lib/auth/authorization";
import { isPreviewDeployment } from "@/lib/runtime-environment";
import { CONTENIDO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Sube una imagen a Vercel Blob y devuelve su URL publica.
// Requiere el almacenamiento Blob conectado en Vercel (variable
// BLOB_READ_WRITE_TOKEN, que Vercel agrega automaticamente).
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
      { error: "Almacenamiento de imagenes no configurado (conecta Vercel Blob)." },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se recibió el archivo correctamente. Vuelve a intentarlo." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No llegó ninguna imagen. Elige un archivo y vuelve a intentarlo." }, { status: 422 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json(
      { error: "Ese archivo no es una imagen. Usa JPG, PNG o WebP." },
      { status: 422 },
    );
  }
  // Limite del cuerpo de una funcion serverless (~4.5 MB). Se comprueba aqui
  // para poder explicarlo; si no, la plataforma corta la peticion y quien
  // sube ve un fallo de red sin motivo.
  if (file.size > 4_400_000) {
    const megas = (file.size / 1_000_000).toFixed(1);
    return NextResponse.json(
      { error: `La imagen pesa ${megas} MB y el máximo son 4 MB. Redúcela e inténtalo de nuevo.` },
      { status: 413 },
    );
  }

  try {
    // Convierte SIEMPRE a JPG (Instagram no acepta PNG) y limita el ancho para
    // que sea compatible y liviana. Asi cualquier imagen que suba el usuario
    // funciona en Instagram y Facebook.
    const input = Buffer.from(await file.arrayBuffer());
    const jpg = await sharp(input)
      .rotate() // respeta la orientacion EXIF
      .resize({ width: 1440, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const blob = await put(`social/${Date.now()}.jpg`, jpg, {
      access: "public",
      contentType: "image/jpeg",
    });
    return NextResponse.json({ url: blob.url });
  } catch (error) {
    // Sin distinguir estos dos casos, un archivo corrupto y una caida del
    // almacenamiento se leen igual en pantalla, y solo uno lo puede resolver
    // quien esta subiendo la imagen.
    const esImagenIlegible = error instanceof Error && /unsupported image format|Input buffer|premature end/i.test(error.message);
    console.error(`[admin/upload] fallo al procesar la imagen: ${esImagenIlegible ? "archivo ilegible" : "almacenamiento"}`);
    return esImagenIlegible
      ? NextResponse.json({ error: "No se pudo leer la imagen. Puede estar dañada o en un formato no admitido; prueba con un JPG o PNG." }, { status: 422 })
      : NextResponse.json({ error: "El almacenamiento de imágenes no respondió. Inténtalo de nuevo en unos minutos." }, { status: 502 });
  }
}
