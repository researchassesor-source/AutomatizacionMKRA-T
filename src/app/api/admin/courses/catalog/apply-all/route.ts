import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { writeAudit } from "@/lib/audit";
import { applyCourseSchedule } from "@/lib/wordpress-sync-orchestrator";

export const dynamic = "force-dynamic";

const schema = z.object({
  confirm: z.literal("APPLY_ALL_SAFE_CHANGES"),
  items: z.array(z.object({
    courseId: z.string().min(1),
    calendarRevision: z.string().min(1),
    sessions: z.array(z.object({
      startAt: z.string().datetime({ message: "La fecha de inicio no es válida." }),
      endAt: z.string().datetime({ message: "La fecha de cierre no es válida." }).nullable(),
    })).min(1),
  })).min(1, "No hay cambios para aplicar."),
});

type ItemResultado =
  | { courseId: string; ok: true; updated: number; created: number; removed: number }
  | { courseId: string; ok: false; code: string; error: string };

/**
 * APLICAR TODOS LOS CAMBIOS SEGUROS (sección L del release de
 * estabilización).
 *
 * Una sola confirmación global, pero CADA curso se aplica de forma
 * independiente reutilizando exactamente la misma reconciliación segura que
 * ya usa el POST por curso (applyCourseSchedule: cuarentena antes de mover
 * fechas, revisión de calendarRevision, reintento de reschedule). Si un
 * curso cambió mientras se revisaba, ese curso se salta con un motivo claro
 * SIN bloquear a los demás -- "resultado por curso", no todo o nada.
 */
export async function POST(request: Request) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Debes confirmar la aplicación de los cambios." }, { status: 422 });
  }

  const resultados: ItemResultado[] = [];
  for (const item of parsed.data.items) {
    const resultado = await applyCourseSchedule(item.courseId, { calendarRevision: item.calendarRevision, sessions: item.sessions }, auth.session);
    if (resultado.ok) {
      resultados.push({ courseId: item.courseId, ok: true, updated: resultado.updated, created: resultado.created, removed: resultado.removed });
      continue;
    }
    const mensaje = resultado.code === "COURSE_NOT_FOUND"
      ? "No se encontró el curso."
      : resultado.code === "REVISION_MISMATCH"
        ? "El calendario cambió mientras lo revisabas. Vuelve a sincronizarlo."
        : resultado.code === "TRANSACTION_FAILED"
          ? "No se pudo actualizar el calendario. No se aplicó ningún cambio en este curso."
          : "El calendario se actualizó, pero los recordatorios quedaron detenidos hasta completar el recálculo. Reintenta este curso.";
    resultados.push({ courseId: item.courseId, ok: false, code: resultado.code, error: mensaje });
  }

  const aplicados = resultados.filter((r) => r.ok).length;
  const desactualizados = resultados.filter((r) => !r.ok && r.code === "REVISION_MISMATCH").length;
  const fallidos = resultados.length - aplicados - desactualizados;

  await writeAudit({
    session: auth.session,
    action: "WORDPRESS_CATALOG_SCHEDULE_APPLY_ALL",
    entityType: "Course",
    result: fallidos > 0 ? "FAILURE" : "SUCCESS",
    metadata: { total: resultados.length, aplicados, desactualizados, fallidos },
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    total: resultados.length,
    aplicados,
    desactualizados,
    fallidos,
    resultados,
  });
}
