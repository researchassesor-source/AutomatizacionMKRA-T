import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";

// Sube una imagen a Vercel Blob y devuelve su URL publica.
// Requiere el almacenamiento Blob conectado en Vercel (variable
// BLOB_READ_WRITE_TOKEN, que Vercel agrega automaticamente).
export async function POST(request: Request) {
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
    return NextResponse.json({ error: "peticion invalida" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "falta el archivo" }, { status: 422 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "el archivo debe ser una imagen" }, { status: 422 });
  }
  // Limite razonable para el body de una funcion serverless (~4.5 MB).
  if (file.size > 4_400_000) {
    return NextResponse.json(
      { error: "La imagen es muy grande (max 4 MB). Reducela e intenta de nuevo." },
      { status: 413 },
    );
  }

  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blob = await put(`social/${Date.now()}-${safeName}`, file, {
      access: "public",
      contentType: file.type,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    console.error("[admin/upload] error", err);
    return NextResponse.json({ error: "no se pudo subir la imagen" }, { status: 500 });
  }
}
