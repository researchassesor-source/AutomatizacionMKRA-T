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

/**
 * Una frase que diga que hacer, en el orden en que conviene mirarlo.
 *
 * Sin esto queda una lista de once campos y el trabajo de interpretarla recae
 * en quien la lee. El orden importa: si la pagina no responde, saber que
 * scopes hay no sirve de nada todavia.
 *
 * Lo que NUNCA hace: convertir una comprobacion no verificable en un problema.
 * Con un token de usuario del sistema hay cosas que no se pueden confirmar, y
 * eso no es un fallo de configuracion.
 */
function motivoFinal(graph: Record<string, unknown>, publicacionVerificada: boolean): string {
  if (!graph.tokenValido) {
    return "El token de Meta no es válido. Hay que generar uno nuevo para el usuario del sistema.";
  }
  if (!graph.paginaAccesible) {
    return `La página no responde a este token: ${String(graph.paginaMotivo ?? "sin detalle")}. Revisa que el identificador sea correcto y que la página esté asignada al usuario del sistema.`;
  }
  if (graph.pageIdSolicitado && graph.pageIdEfectivo && graph.pageIdSolicitado !== graph.pageIdEfectivo) {
    return `Se pidió la página ${String(graph.pageIdSolicitado)} y Meta respondió con ${String(graph.pageIdEfectivo)}. Se estaría publicando en una página distinta de la esperada.`;
  }
  const ausentes = Array.isArray(graph.scopesRequeridosAusentes) ? (graph.scopesRequeridosAusentes as string[]) : [];
  if (graph.scopesVerificables && ausentes.length > 0) {
    return `Al token le faltan estos permisos: ${ausentes.join(" y ")}. Concédelos en la app de Meta y genera el token de nuevo, porque los permisos se fijan al emitirlo.`;
  }
  const tareas = Array.isArray(graph.tareasSobreLaPagina) ? (graph.tareasSobreLaPagina as string[]) : [];
  if (graph.tareasVerificables && !tareas.includes("CREATE_CONTENT")) {
    return tareas.length === 0
      ? "El usuario del sistema no tiene ninguna tarea sobre esta página. Asígnasela en Business Settings con la tarea «Crear contenido»."
      : `El usuario del sistema tiene ${tareas.join(", ")} sobre esta página, pero le falta «Crear contenido», que es la que Meta exige para publicar.`;
  }
  if (publicacionVerificada) {
    return "Configuración correcta y publicación real verificada. El canal funciona de extremo a extremo.";
  }
  if (!graph.scopesVerificables || !graph.tareasVerificables) {
    return "La conexión está configurada y no se detecta ningún permiso ausente, pero con este tipo de token no todo puede verificarse desde aquí. Solo una publicación real confirmará que el canal funciona.";
  }
  return "La configuración se ve correcta, pero todavía no hay ninguna publicación real que lo confirme.";
}

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
  const graph = await adapter.diagnose();

  /**
   * Publicacion real verificada: lo dice el historial, no la Graph API.
   *
   * Se exige `externalPostId` porque un registro marcado como publicado sin
   * identificador del proveedor no demuestra nada. Las publicaciones simuladas
   * quedan fuera por el mismo motivo.
   */
  const ultimaPublicada = await prisma.socialPost.findFirst({
    where: { accountId: account.id, status: "PUBLICADO", externalPostId: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { publishedAt: true, externalPostId: true },
  });
  const ultimoFallo = await prisma.socialPost.findFirst({
    where: { accountId: account.id, status: "FALLIDO" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, errorCode: true, errorMessage: true },
  });

  const informe = {
    ...graph,
    publicacionVerificada: Boolean(ultimaPublicada),
    publicacionMotivo: ultimaPublicada
      ? `Última publicación real correcta el ${ultimaPublicada.publishedAt?.toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) ?? "—"}.`
      : "Todavía no hay ninguna publicación real correcta en esta cuenta.",
    ultimoFallo: ultimoFallo
      ? {
          cuando: ultimoFallo.createdAt.toLocaleString("es-EC", { timeZone: "America/Guayaquil" }),
          motivo: ultimoFallo.errorMessage ?? ultimoFallo.errorCode ?? "sin detalle",
        }
      : null,
    motivoFinal: motivoFinal(graph, Boolean(ultimaPublicada)),
  };

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
