import { NextResponse } from "next/server";
import { z } from "zod";
import { diagnosePausedAutomations, recoverPausedAutomations } from "@/lib/automation-pause-diagnostics";
import { requireRole } from "@/lib/auth/authorization";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";
import { CONTENIDO, TECNICO } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/** Diagnóstico de solo lectura: qué automatizaciones están pausadas y por qué. */
export async function GET(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  return NextResponse.json(await diagnosePausedAutomations());
}

const recoverySchema = z.object({
  confirm: z.literal(true),
  courseId: z.string().trim().min(1).max(100).optional(),
  /** Reprograma los mensajes de las inscripciones tras reactivar. */
  reschedule: z.boolean().default(true),
});

/**
 * Recuperación controlada. Solo reactiva reglas que hoy vuelven a ser
 * ejecutables, es decir, cuya pausa fue un error. Reservada a ADMIN porque
 * reactivar una regla puede derivar en envíos reales.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, TECNICO);
  if (auth.error) return auth.error;
  const parsed = recoverySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Debes confirmar explícitamente la recuperación." }, { status: 422 });
  }

  const result = await recoverPausedAutomations(auth.session, { courseId: parsed.data.courseId });
  const rescheduled: Array<{ courseId: string; enqueued: number; updated: number; omitted: number }> = [];
  if (parsed.data.reschedule) {
    for (const course of result.details) {
      const summary = await rescheduleCourseAutomations(course.courseId);
      rescheduled.push({ courseId: course.courseId, enqueued: summary.enqueued, updated: summary.updated, omitted: summary.omitted });
    }
  }

  return NextResponse.json({
    ok: true,
    ...result,
    rescheduled,
    message: result.reactivated === 0
      ? "No hay automatizaciones pausadas por error: ninguna se reactivó."
      : `Se reactivaron ${result.reactivated} automatizaciones en ${result.courses} curso(s). Las demás siguen pausadas por un motivo válido.`,
  });
}
