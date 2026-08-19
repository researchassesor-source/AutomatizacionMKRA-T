import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { TECNICO } from "@/lib/auth/roles";
import { wordpressCatalogConfigured } from "@/lib/wordpress-catalog";
import { analyzeWordPressSync } from "@/lib/wordpress-sync-orchestrator";

export const dynamic = "force-dynamic";

const schema = z.object({ confirm: z.literal("SYNC_WORDPRESS_READ_ONLY") });

/**
 * ANALYZE WORDPRESS SYNC (sección K del release de estabilización).
 *
 * Un solo viaje de servidor: sincroniza y valida el catálogo completo,
 * descubre e incorpora cursos nuevos, y lee el calendario de TODOS los
 * cursos vigentes en la lista YA actualizada -- nunca la de antes del sync.
 * Nada se aplica todavía: es la misma promesa de solo-lectura que ya tenía
 * schedule-proposal GET, ahora para el catálogo entero de una sola vez.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!wordpressCatalogConfigured()) {
    return NextResponse.json({ error: "Falta configurar el endpoint REST de cursos de WordPress con permiso mínimo de lectura." }, { status: 409 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Falta la confirmación de sincronización de solo lectura." }, { status: 422 });

  const analysis = await analyzeWordPressSync(auth.session);
  if (!analysis.ok) return NextResponse.json({ ok: false, error: analysis.catalogError }, { status: 502 });
  return NextResponse.json(analysis);
}
