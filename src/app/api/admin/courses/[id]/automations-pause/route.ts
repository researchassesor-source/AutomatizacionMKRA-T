import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { quarantineRecoverableMessages } from "@/lib/nurture/queue-safety";

export const dynamic = "force-dynamic";

/**
 * Pausa o reanuda las automatizaciones de UN curso.
 *
 * Hasta ahora la unica forma de callar un curso era despublicarlo, y eso ademas
 * lo retira de la web publica: una decision operativa acababa teniendo
 * consecuencias comerciales. Esto detiene solo sus envios.
 *
 * No borra nada. Las reglas siguen configuradas, los mensajes ya enviados
 * siguen en el historial y los pendientes conservan su fecha; simplemente
 * dejan de programarse y de salir mientras dure la pausa. Al reanudar todo
 * continua desde donde estaba, sin reenviar nada de lo ya enviado.
 */
const schema = z.object({ paused: z.boolean(), confirm: z.literal(true) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  if (!auth.session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Datos no válidos." }, { status: 422 });
  }

  const { id } = await params;
  const curso = await prisma.course.findUnique({ where: { id }, select: { id: true, title: true, automationsPausedAt: true } });
  if (!curso) return NextResponse.json({ error: "El curso no existe." }, { status: 404 });

  /**
   * Pausar pone en cuarentena la cola EN EL MISMO INSTANTE, dentro de la misma
   * transaccion que marca el curso pausado. Antes de esto solo existia el
   * cerrojo de ultimo momento en sendMessage: correcto, pero significaba que
   * un mensaje ya PROGRAMADO seguia "pendiente de enviar" en el panel hasta
   * que le tocara su hora y recien ahi se descubriera la pausa. Poner en
   * cuarentena aqui hace que el estado se refleje de inmediato.
   */
  let quarantined = 0;
  const actualizado = await prisma.$transaction(async (tx) => {
    const curso2 = await tx.course.update({
      where: { id },
      data: parsed.data.paused
        ? { automationsPausedAt: new Date(), automationsPausedBy: auth.session?.email ?? null }
        : { automationsPausedAt: null, automationsPausedBy: null },
      select: { automationsPausedAt: true, automationsPausedBy: true },
    });
    if (parsed.data.paused) {
      quarantined = await quarantineRecoverableMessages(
        tx,
        { enrollment: { courseId: id } },
        { errorCode: "COURSE_AUTOMATIONS_PAUSED", errorMessage: "No se envió: las automatizaciones de este curso están en pausa." },
      );
    }
    return curso2;
  });

  await writeAudit({
    session: auth.session,
    action: parsed.data.paused ? "COURSE_AUTOMATIONS_PAUSED" : "COURSE_AUTOMATIONS_RESUMED",
    entityType: "Course",
    entityId: id,
    result: "SUCCESS",
    metadata: { curso: curso.title, quarantined },
  });

  /**
   * Reanudar: lo que se quedo OMITIDO/COURSE_AUTOMATIONS_PAUSED (el cerrojo de
   * ultimo momento en sendMessage) necesita que alguien lo vuelva a evaluar.
   * Sin este llamado se quedaria pausado para siempre aunque el curso ya no lo
   * estuviera.
   */
  if (!parsed.data.paused) {
    await rescheduleCourseAutomations(id).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    pausado: Boolean(actualizado.automationsPausedAt),
    desde: actualizado.automationsPausedAt?.toISOString() ?? null,
    por: actualizado.automationsPausedBy,
    quarantined,
  });
}
