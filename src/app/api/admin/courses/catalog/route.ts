import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { canApplyCourseCatalog } from "@/lib/course-catalog";
import { applyOfficialCourseCatalog, loadCourseCatalogReport } from "@/lib/course-catalog-server";
import { PayloadTooLargeError, readJsonBody } from "@/lib/http";

const applySchema = z.object({ confirm: z.literal("IMPORTAR_CATALOGO_OFICIAL") }).strict();

export async function GET(request: Request) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  return NextResponse.json(await loadCourseCatalogReport());
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!canApplyCourseCatalog()) {
    return NextResponse.json(
      { error: "La importación automática del catálogo está bloqueada en Producción." },
      { status: 409 },
    );
  }

  try {
    const parsed = applySchema.safeParse(await readJsonBody(request, 4_096));
    if (!parsed.success) {
      return NextResponse.json({ error: "La confirmación del catálogo no es válida." }, { status: 422 });
    }
    const result = await applyOfficialCourseCatalog(auth.session);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
    }
    console.error("[course-catalog] No se pudo importar el catálogo.");
    return NextResponse.json({ error: "No se pudo importar el catálogo oficial." }, { status: 500 });
  }
}
