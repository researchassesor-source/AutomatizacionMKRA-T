import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { TECNICO } from "@/lib/auth/roles";
import { checkRateLimit, requestKey } from "@/lib/rate-limit";
import { auditarPlantillasConMeta } from "@/lib/whatsapp/template-audit";

export const dynamic = "force-dynamic";

/**
 * Compara las plantillas del CRM con las registradas en Meta.
 *
 * Solo GET, y todo lo que hace por dentro tambien: una lectura de
 * `message_templates`. No envia ningun mensaje, no crea ni edita plantillas y
 * no toca el estado del canal. Por eso puede consultarse con WhatsApp activo
 * sin que nadie reciba nada.
 *
 * La respuesta no incluye la peticion a Meta ni ninguna cabecera: el token
 * viaja en `Authorization` y devolverlo, aunque fuera dentro de un diagnostico,
 * lo dejaria escrito en el navegador de quien lo consulte.
 */
export async function GET(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;

  // Cada consulta recorre la paginacion completa de Meta. El limite evita que
  // recargar el panel se convierta en una tormenta de peticiones a Graph.
  const limit = await checkRateLimit(requestKey(request, "whatsapp-templates-audit"), { limit: 10, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de auditorías. Espera unos minutos." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const resultado = await auditarPlantillasConMeta();

  if (!resultado.ok) {
    await writeAudit({
      session: auth.session,
      action: "WHATSAPP_TEMPLATES_AUDITED",
      entityType: "WhatsAppTemplate",
      result: "FAILURE",
      metadata: { errorCode: resultado.errorCode },
    });
    // Falta de configuracion es 422 (hay que arreglarla aqui); un fallo de Meta
    // es 502 (la peticion salio y el otro extremo la rechazo).
    const status = resultado.errorCode.startsWith("WHATSAPP_") ? 422 : 502;
    return NextResponse.json({ ok: false, errorCode: resultado.errorCode, error: resultado.error }, { status });
  }

  await writeAudit({
    session: auth.session,
    action: "WHATSAPP_TEMPLATES_AUDITED",
    entityType: "WhatsAppTemplate",
    result: "SUCCESS",
    metadata: { green: resultado.green, yellow: resultado.yellow, red: resultado.red, total: resultado.total },
  });

  return NextResponse.json({
    ok: true,
    green: resultado.green,
    yellow: resultado.yellow,
    red: resultado.red,
    total: resultado.total,
    plantillas: resultado.plantillas,
    message: `${resultado.green} coinciden, ${resultado.yellow} con aviso y ${resultado.red} con desajuste. Solo se leyó Meta: no se envió ningún mensaje.`,
  });
}
