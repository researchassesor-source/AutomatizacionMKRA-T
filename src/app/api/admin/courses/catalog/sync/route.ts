import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { safeWordPressErrorCode, synchronizeWordPressCatalog, wordpressCatalogConfigured } from "@/lib/wordpress-catalog";

const schema = z.object({ confirm: z.literal("SYNC_WORDPRESS_READ_ONLY") });

export async function POST(request: Request) {
  const auth = await requireRole(request, ["ADMIN"]);
  if (auth.error) return auth.error;
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!wordpressCatalogConfigured()) return NextResponse.json({ error: "Falta configurar el endpoint REST de cursos de WordPress con permiso mínimo de lectura." }, { status: 409 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta la confirmación de sincronización de solo lectura." }, { status: 422 });
  try {
    return NextResponse.json({ ok: true, ...(await synchronizeWordPressCatalog(auth.session)) });
  } catch (error) {
    const code = safeWordPressErrorCode(error);
    return NextResponse.json({ error: `La sincronización se detuvo de forma segura (${code}).` }, { status: 502 });
  }
}
