import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { TECNICO } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { MetaAdapter } from "@/lib/social/adapters/meta";
import { resolveMetaConfig } from "@/lib/social/meta-config";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Diagnostico de permisos de Meta, en solo lectura.
 *
 * Existe porque "Meta rechazó la publicación por permisos insuficientes" no le
 * dice a nadie que tiene que cambiar. Meta devuelve el mismo `code: 200` tanto
 * si al token le faltan permisos como si al usuario del sistema no le han
 * asignado la pagina, y desde fuera esos dos casos se arreglan en sitios
 * distintos.
 *
 * Solo hace GET contra Graph: consulta identidad, permisos del token y tareas
 * sobre la pagina. NO publica nada y NO reintenta ninguna publicacion.
 *
 * El token no se devuelve nunca, ni completo ni parcial: se informa de su tipo,
 * de si es valido y de que permisos lleva, que es lo unico accionable.
 */
const schema = z.object({
  accountId: z.string().trim().min(1, "Indica la cuenta a diagnosticar."),
});

export async function POST(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;

  const limit = await checkRateLimit(requestKey(request, "social-diagnose"), { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de diagnósticos. Espera unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }

  const account = await prisma.socialAccount.findUnique({ where: { id: parsed.data.accountId } });
  if (!account) return NextResponse.json({ error: "La cuenta no existe." }, { status: 404 });
  if (account.platform !== "FACEBOOK" && account.platform !== "INSTAGRAM") {
    return NextResponse.json({ error: "El diagnóstico de permisos solo aplica a Facebook e Instagram." }, { status: 422 });
  }

  const adapter = new MetaAdapter(account.platform, resolveMetaConfig(), account.externalId);
  const informe = await adapter.diagnose();

  await writeAudit({
    session: auth.session,
    action: "SOCIAL_PERMISSIONS_DIAGNOSED",
    entityType: "SocialAccount",
    entityId: account.id,
    metadata: {
      platform: account.platform,
      puedePublicar: Boolean((informe as { puedePublicar?: boolean }).puedePublicar),
      origenDelDestino: String((informe as { origenDelDestino?: string }).origenDelDestino ?? ""),
    },
  });

  return NextResponse.json({
    ok: true,
    cuenta: { id: account.id, nombre: account.displayName, plataforma: account.platform, externalId: account.externalId },
    ...informe,
  });
}
