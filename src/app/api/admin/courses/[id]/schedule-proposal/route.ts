import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { analyzeCourseSchedule, applyCourseSchedule } from "@/lib/wordpress-sync-orchestrator";

export const dynamic = "force-dynamic";

/**
 * Lee la ficha pública del curso y PROPONE un calendario (GET) o aplica uno
 * ya confirmado (POST), para UN curso.
 *
 * La lógica real vive en wordpress-sync-orchestrator.ts, compartida con el
 * barrido global "Sincronizar con la web" (sección K/L del release de
 * estabilización): esta ruta es un envoltorio delgado para que el flujo por
 * curso siga funcionando exactamente igual que antes.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const { id } = await params;

  const course = await prisma.course.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      officialUrl: true,
      officialCourseUrl: true,
      sessions: { select: { id: true, startAt: true, endAt: true }, orderBy: { startAt: "asc" } },
    },
  });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const analysis = await analyzeCourseSchedule(course);
  const { courseId: _courseId, courseTitle, ...rest } = analysis;
  return NextResponse.json({ ...rest, courseTitle });
}

const reconcileSchema = z.object({
  confirm: z.literal("APPLY_WORDPRESS_SCHEDULE"),
  calendarRevision: z.string().min(1, "Falta la huella del calendario revisado."),
  sessions: z.array(z.object({
    startAt: z.string().datetime({ message: "La fecha de inicio no es válida." }),
    endAt: z.string().datetime({ message: "La fecha de cierre no es válida." }).nullable(),
  })).min(1, "No hay fechas para aplicar."),
});

/**
 * Aplica un calendario YA CONFIRMADO por una persona. WordPress sigue siendo
 * de solo lectura: esta ruta nunca lo consulta, solo recibe las fechas que el
 * cliente ya mostró y que el administrador aceptó explícitamente.
 *
 * Ver applyCourseSchedule en wordpress-sync-orchestrator.ts para el detalle
 * de la transacción (cuarentena/cancelación antes de mover fechas, revisión
 * de calendarRevision, reintento de reschedule con 503 honesto).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = reconcileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Debes confirmar el cambio de calendario." }, { status: 422 });
  }
  const { id } = await params;

  const resultado = await applyCourseSchedule(id, { calendarRevision: parsed.data.calendarRevision, sessions: parsed.data.sessions }, auth.session);

  if (resultado.ok) {
    return NextResponse.json({
      ok: true,
      updated: resultado.updated,
      removed: resultado.removed,
      created: resultado.created,
      cancelledMessages: resultado.cancelledMessages,
      quarantinedMessages: resultado.quarantinedMessages,
      rescheduled: resultado.rescheduled,
    });
  }
  if (resultado.code === "COURSE_NOT_FOUND") return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });
  if (resultado.code === "REVISION_MISMATCH") {
    return NextResponse.json({ error: "El calendario cambió mientras lo revisabas. Vuelve a sincronizar antes de aplicarlo." }, { status: 409 });
  }
  if (resultado.code === "TRANSACTION_FAILED") {
    return NextResponse.json({ error: "No se pudo actualizar el calendario. No se aplicó ningún cambio." }, { status: 500 });
  }
  return NextResponse.json({
    ok: false,
    calendarUpdated: true,
    messagesSafe: true,
    error: "El calendario se actualizó, pero los recordatorios quedaron detenidos hasta completar el recálculo. Reintenta.",
  }, { status: 503 });
}
