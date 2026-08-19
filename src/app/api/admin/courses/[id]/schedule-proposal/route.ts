import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { compareCourseSchedule, planScheduleReconciliation } from "@/lib/course-schedule-reconciliation";
import { prisma } from "@/lib/db";
import { proponerCalendario } from "@/lib/course-schedule-parser";
import { rescheduleCourseAutomations } from "@/lib/nurture/engine";

export const dynamic = "force-dynamic";

/**
 * Lee la ficha publica del curso y PROPONE un calendario.
 *
 * Solo lee. No crea ni modifica ninguna sesion: una fecha mal interpretada
 * programaria recordatorios reales en el dia equivocado, asi que la propuesta
 * siempre pasa por una confirmacion humana con los valores actuales y los
 * propuestos a la vista.
 *
 * La URL no la elige quien llama: se toma del curso en la base, y solo se
 * acepta el dominio oficial. Asi esta ruta no puede convertirse en un
 * mecanismo para hacer peticiones a servidores ajenos desde el servidor.
 */
const DOMINIO_OFICIAL = "ra-training.com";

type ExistingSessionJSON = { startAt: string; endAt: string | null };

function existingSessionsResponse(sessions: Array<{ startAt: Date; endAt: Date | null }>): ExistingSessionJSON[] {
  return sessions.map((session) => ({ startAt: session.startAt.toISOString(), endAt: session.endAt?.toISOString() ?? null }));
}

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
  const existingSessions = existingSessionsResponse(course.sessions);

  const raw = course.officialUrl ?? course.officialCourseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, status: "ERROR", motivo: "El curso no tiene una dirección web válida.", existingSessions });
  }
  if (url.protocol !== "https:" || (url.hostname !== DOMINIO_OFICIAL && url.hostname !== `www.${DOMINIO_OFICIAL}`)) {
    return NextResponse.json({ ok: false, status: "ERROR", motivo: "La dirección del curso no pertenece al sitio oficial.", existingSessions });
  }

  let html: string;
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "RA-Training-CRM/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, status: "ERROR", motivo: `La página del curso respondió ${response.status}.`, existingSessions });
    }
    html = await response.text();
  } catch {
    return NextResponse.json({ ok: false, status: "ERROR", motivo: "No se pudo abrir la página del curso.", existingSessions });
  }

  const propuesta = proponerCalendario(html);
  if (!propuesta.ok) {
    return NextResponse.json({ ...propuesta, status: "SIN_FECHA_EN_WORDPRESS", courseTitle: course.title, sourceUrl: url.toString(), existingSessions });
  }
  const status = compareCourseSchedule(course.sessions, propuesta.sessions);
  return NextResponse.json({ ...propuesta, status, courseTitle: course.title, sourceUrl: url.toString(), existingSessions });
}

const reconcileSchema = z.object({
  confirm: z.literal(true),
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
 * Reconciliación transaccional y fail-closed: si algo falla, no queda ninguna
 * sesión a medio actualizar. Las sesiones emparejadas por posición preservan
 * su id (los mensajes ya programados se reprograman, no se recrean); las
 * sobrantes cancelan explícitamente sus mensajes pendientes ANTES de
 * eliminarse, para no depender de que la limpieza de huérfanos las alcance
 * después de que la baja ya les haya puesto courseSessionId en null.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;
  const parsed = reconcileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Debes confirmar el cambio de calendario." }, { status: 422 });
  }
  const { id } = await params;
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const existing = await prisma.courseSession.findMany({ where: { courseId: id }, select: { id: true, startAt: true, endAt: true } });
  const plan = planScheduleReconciliation(
    existing,
    parsed.data.sessions.map((session) => ({ startAt: session.startAt, endAt: session.endAt })),
  );

  let cancelledMessages = 0;
  try {
    await prisma.$transaction(async (tx) => {
      if (plan.toRemove.length > 0) {
        const removedIds = plan.toRemove.map((session) => session.id);
        const cancelled = await tx.outboundMessage.updateMany({
          where: { courseSessionId: { in: removedIds }, status: { in: ["PROGRAMADO", "OMITIDO"] } },
          data: { status: "CANCELADO", cancelledAt: new Date(), errorCode: "SESSION_REMOVED", errorMessage: "La sesión asociada dejó de existir." },
        });
        cancelledMessages = cancelled.count;
        await tx.courseSession.deleteMany({ where: { id: { in: removedIds } } });
      }
      for (const update of plan.toUpdate) {
        await tx.courseSession.update({ where: { id: update.id }, data: { startAt: update.startAt, endAt: update.endAt } });
      }
      for (const create of plan.toCreate) {
        await tx.courseSession.create({ data: { courseId: id, startAt: create.startAt, endAt: create.endAt } });
      }
    });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar el calendario. No se aplicó ningún cambio." }, { status: 500 });
  }

  await writeAudit({
    session: auth.session,
    action: "COURSE_SCHEDULE_RECONCILED",
    entityType: "Course",
    entityId: id,
    metadata: { updated: plan.toUpdate.length, removed: plan.toRemove.length, created: plan.toCreate.length, cancelledMessages },
  });

  const rescheduled = await rescheduleCourseAutomations(id);
  return NextResponse.json({
    ok: true,
    updated: plan.toUpdate.length,
    removed: plan.toRemove.length,
    created: plan.toCreate.length,
    cancelledMessages,
    rescheduled,
  });
}
