import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { CONTENIDO } from "@/lib/auth/roles";
import { calendarRevisionOf, compareCourseSchedule, planScheduleReconciliation, type ReconciliationPlan } from "@/lib/course-schedule-reconciliation";
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
  // Huella del calendario tal como se muestra ahora. El cliente la devuelve
  // sin tocar al confirmar, para que la ruta pueda detectar si alguien más
  // cambió las sesiones mientras esta propuesta seguía en pantalla.
  const calendarRevision = calendarRevisionOf(course.sessions);

  const raw = course.officialUrl ?? course.officialCourseUrl;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ ok: false, status: "ERROR", motivo: "El curso no tiene una dirección web válida.", existingSessions, calendarRevision });
  }
  if (url.protocol !== "https:" || (url.hostname !== DOMINIO_OFICIAL && url.hostname !== `www.${DOMINIO_OFICIAL}`)) {
    return NextResponse.json({ ok: false, status: "ERROR", motivo: "La dirección del curso no pertenece al sitio oficial.", existingSessions, calendarRevision });
  }

  let html: string;
  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "RA-Training-CRM/1.0" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return NextResponse.json({ ok: false, status: "ERROR", motivo: `La página del curso respondió ${response.status}.`, existingSessions, calendarRevision });
    }
    html = await response.text();
  } catch {
    return NextResponse.json({ ok: false, status: "ERROR", motivo: "No se pudo abrir la página del curso.", existingSessions, calendarRevision });
  }

  const propuesta = proponerCalendario(html);
  if (!propuesta.ok) {
    return NextResponse.json({ ...propuesta, status: "SIN_FECHA_EN_WORDPRESS", courseTitle: course.title, sourceUrl: url.toString(), existingSessions, calendarRevision });
  }
  const status = compareCourseSchedule(course.sessions, propuesta.sessions);
  return NextResponse.json({ ...propuesta, status, courseTitle: course.title, sourceUrl: url.toString(), existingSessions, calendarRevision });
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
 * Todo lo que puede dejar el calendario a medias vive DENTRO de la misma
 * transacción Serializable:
 *   - la lectura de las sesiones actuales y el cálculo del plan (si se
 *     hicieran antes, otra petición concurrente podría cambiarlas entre la
 *     lectura y la escritura);
 *   - la comprobación de `calendarRevision` contra lo que se acaba de leer,
 *     para abortar sin escribir nada si alguien más cambió el calendario
 *     mientras esta propuesta seguía en pantalla;
 *   - cancelar los mensajes pendientes de las sesiones que sobran, ANTES de
 *     eliminarlas (si se hiciera después, `onDelete: SetNull` ya les habría
 *     puesto courseSessionId en null y la limpieza de huérfanos no las vería);
 *   - poner en cuarentena (OMITIDO/SCHEDULE_RECONCILING) los mensajes
 *     pendientes de las sesiones que SÍ cambian de fecha, ANTES de mover esa
 *     fecha. Sin esto, si rescheduleCourseAutomations fallara justo después
 *     del commit, un PROGRAMADO con la fecha vieja podría salir igual.
 *
 * rescheduleCourseAutomations corre DESPUÉS del commit (no se puede anidar
 * dentro: usa su propio prisma.$transaction con el cliente global, no el de
 * esta transacción). Si falla, se reintenta una vez; si vuelve a fallar, la
 * respuesta deja claro que el calendario YA cambió y que los mensajes están a
 * salvo en cuarentena, nunca "no se aplicó ningún cambio". El motor no
 * necesita saber nada de SCHEDULE_RECONCILING: para
 * rescheduleCourseAutomations es un OMITIDO más, reprogramable como
 * cualquier otro en cuanto se lo vuelve a llamar.
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

  const proposedSessions = parsed.data.sessions.map((session) => ({ startAt: session.startAt, endAt: session.endAt }));
  let plan: ReconciliationPlan = { toUpdate: [], toRemove: [], toCreate: [] };
  let revisionMismatch = false;
  let cancelledMessages = 0;
  let quarantinedMessages = 0;

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.courseSession.findMany({ where: { courseId: id }, select: { id: true, startAt: true, endAt: true } });
      if (calendarRevisionOf(existing) !== parsed.data.calendarRevision) {
        revisionMismatch = true;
        return;
      }
      plan = planScheduleReconciliation(existing, proposedSessions);

      if (plan.toRemove.length > 0) {
        const removedIds = plan.toRemove.map((session) => session.id);
        const cancelled = await tx.outboundMessage.updateMany({
          where: { courseSessionId: { in: removedIds }, status: { in: ["PROGRAMADO", "OMITIDO"] } },
          data: { status: "CANCELADO", cancelledAt: new Date(), errorCode: "SESSION_REMOVED", errorMessage: "La sesión asociada dejó de existir." },
        });
        cancelledMessages = cancelled.count;
        await tx.courseSession.deleteMany({ where: { id: { in: removedIds } } });
      }
      if (plan.toUpdate.length > 0) {
        const updatedIds = plan.toUpdate.map((session) => session.id);
        const quarantined = await tx.outboundMessage.updateMany({
          where: { courseSessionId: { in: updatedIds }, status: { in: ["PROGRAMADO", "OMITIDO"] } },
          data: {
            status: "OMITIDO",
            errorCode: "SCHEDULE_RECONCILING",
            errorMessage: "El calendario cambió y este aviso está esperando ser recalculado.",
            nextAttemptAt: null,
          },
        });
        quarantinedMessages = quarantined.count;
        for (const update of plan.toUpdate) {
          await tx.courseSession.update({ where: { id: update.id }, data: { startAt: update.startAt, endAt: update.endAt } });
        }
      }
      for (const create of plan.toCreate) {
        await tx.courseSession.create({ data: { courseId: id, startAt: create.startAt, endAt: create.endAt } });
      }
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 20_000 });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar el calendario. No se aplicó ningún cambio." }, { status: 500 });
  }

  if (revisionMismatch) {
    return NextResponse.json({ error: "El calendario cambió mientras lo revisabas. Vuelve a sincronizar antes de aplicarlo." }, { status: 409 });
  }

  await writeAudit({
    session: auth.session,
    action: "COURSE_SCHEDULE_RECONCILED",
    entityType: "Course",
    entityId: id,
    metadata: { updated: plan.toUpdate.length, removed: plan.toRemove.length, created: plan.toCreate.length, cancelledMessages, quarantinedMessages },
  });

  // El calendario YA está confirmado en la base a partir de aquí. Un fallo de
  // aquí en adelante nunca puede volver a decir "no se aplicó ningún cambio".
  let rescheduled: Awaited<ReturnType<typeof rescheduleCourseAutomations>>;
  try {
    rescheduled = await rescheduleCourseAutomations(id);
  } catch {
    try {
      rescheduled = await rescheduleCourseAutomations(id);
    } catch {
      return NextResponse.json({
        ok: false,
        calendarUpdated: true,
        messagesSafe: true,
        error: "El calendario se actualizó, pero los recordatorios quedaron detenidos hasta completar el recálculo. Reintenta.",
      }, { status: 503 });
    }
  }

  return NextResponse.json({
    ok: true,
    updated: plan.toUpdate.length,
    removed: plan.toRemove.length,
    created: plan.toCreate.length,
    cancelledMessages,
    quarantinedMessages,
    rescheduled,
  });
}
