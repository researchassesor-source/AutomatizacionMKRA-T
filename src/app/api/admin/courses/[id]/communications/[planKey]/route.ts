import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { TIMELINE_STEPS } from "@/lib/course-timeline";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

const schema = z.object({ enabled: z.boolean(), confirm: z.literal(true) });

/**
 * Enciende o apaga un paso completo del recorrido.
 *
 * Un paso puede tener regla de correo y de WhatsApp, y para quien administra es
 * una sola decision: "esto se envia o no". Por eso el cambio va en una
 * transaccion: dejar el correo activo y el WhatsApp pausado por un fallo a
 * mitad seria un estado que nadie eligio y que nadie mira.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; planKey: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Petición no válida." }, { status: 422 });

  const { id, planKey } = await params;
  // El paso tiene que ser uno de los once: un planKey libre permitiria tocar
  // reglas que no pertenecen al recorrido.
  if (!TIMELINE_STEPS.some((step) => step.planKey === planKey)) {
    return NextResponse.json({ error: "Ese paso no existe.", errorCode: "STEP_UNKNOWN" }, { status: 422 });
  }

  const curso = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!curso) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const reglas = await prisma.automationRule.findMany({
    where: { courseId: id, planKey, status: { not: "ARCHIVED" } },
    select: { id: true, status: true },
  });
  if (reglas.length === 0) {
    return NextResponse.json({ error: "Este paso todavía no tiene una regla configurada.", errorCode: "STEP_NOT_CONFIGURED" }, { status: 409 });
  }

  const ids = reglas.map((r) => r.id);
  const nuevoEstado = parsed.data.enabled ? "ACTIVE" : "PAUSED";

  await prisma.$transaction(async (tx) => {
    await tx.automationRule.updateMany({ where: { id: { in: ids } }, data: { status: nuevoEstado } });
    if (!parsed.data.enabled) {
      // Solo lo que aun no ha salido. Lo enviado es historial y no se toca.
      await tx.outboundMessage.updateMany({
        where: { automationRuleId: { in: ids }, status: "PROGRAMADO" },
        data: { status: "CANCELADO", cancelledAt: new Date() },
      });
    }
  });

  let reprogramado = false;
  if (parsed.data.enabled) {
    /**
     * Reprogramar va FUERA de la transaccion y no la revierte si falla.
     *
     * La eleccion de quien administra ya esta guardada; si el reschedule
     * tropieza, el reloj lo recoge en la siguiente vuelta. Deshacer el cambio
     * de estado seria peor: la pantalla diria una cosa y la base otra.
     */
    try {
      await rescheduleCourseAutomations(id);
      reprogramado = true;
    } catch (error: unknown) {
      await writeAudit({
        session: auth.session,
        action: "COURSE_COMMUNICATION_STEP_UPDATED",
        entityType: "Course",
        entityId: id,
        result: "FAILURE",
        metadata: { planKey, enabled: true, error: error instanceof Error ? error.message.slice(0, 200) : "fallo" },
      }).catch(() => undefined);
    }
  }

  await writeAudit({
    session: auth.session,
    action: "COURSE_COMMUNICATION_STEP_UPDATED",
    entityType: "Course",
    entityId: id,
    // Ni asuntos ni cuerpos: basta saber que paso cambio y cuantas reglas.
    metadata: { planKey, enabled: parsed.data.enabled, ruleCount: reglas.length, reprogramado },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, enabled: parsed.data.enabled, ruleCount: reglas.length });
}
