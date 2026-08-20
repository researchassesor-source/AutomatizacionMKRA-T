import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/authorization";
import { nextFixedRuleExecution } from "@/lib/automation-schedule";
import { CONTENIDO } from "@/lib/auth/roles";
import { courseAutomationWindow } from "@/lib/course-automation-window";
import { TIMELINE_STEPS } from "@/lib/course-timeline";
import { prisma } from "@/lib/db";
import { markCourseAutomationReconcilePending, reconcileCourseDerivedState } from "@/lib/nurture/course-reconciliation";
import { planEntryFor } from "@/lib/nurture/plan-entry";

export const dynamic = "force-dynamic";

const schema = z.object({
  channels: z.array(z.enum(["EMAIL", "WHATSAPP"])).min(1, "Elige al menos un canal."),
  /** Si se omite, se usa el desfase del plan estandar de ese paso. */
  offsetMinutes: z.coerce.number().int().min(0).max(525_600).optional(),
  confirm: z.literal(true),
});

function esErrorDeUnicidad(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/**
 * Crea, revive o reanuda las AutomationRule que le faltan a un paso del
 * recorrido, canal por canal.
 *
 * Seccion C del cierre de produccion: seleccionar la tarjeta de un paso
 * significa "que salgan TODOS sus canales disponibles", no solo el que ya
 * existiera. Antes, si solo habia una regla de correo activa, la tarjeta se
 * mostraba como completa y encenderla no creaba el WhatsApp que faltaba -el
 * cliente solo llamaba aqui cuando no habia ninguna regla en absoluto-. Este
 * endpoint es idempotente por canal: si ya esta ACTIVE no lo toca, si esta
 * PAUSED lo reanuda sin pisar su contenido, si esta ARCHIVED o no existe lo
 * (re)crea con el plan estandar.
 *
 * El contenido -asunto, cuerpo, plantilla de Meta- sale siempre del plan
 * estandar (`planEntryFor`), nunca del cliente: asi no hay forma de crear una
 * regla de WhatsApp con una plantilla que Meta no reconozca. Lo unico que el
 * administrador elige aqui son los canales y, si quiere, el desfase. Una
 * regla PAUSED que ya tenia contenido editado se reanuda tal cual: solo se
 * pisa el contenido cuando se crea desde cero o se revive desde ARCHIVED.
 *
 * Cada canal se crea con su propia escritura -sin envolver ambos canales en
 * una sola transaccion- porque el unique (courseId, channel, planKey) ya
 * existente es lo que de verdad evita el duplicado en un doble clic: si dos
 * peticiones compiten por el mismo canal, una gana y la otra recibe un
 * choque de unicidad que aqui se trata como "ya estaba configurado", no como
 * error. Con Postgres, meter ese choque dentro de una transaccion compartida
 * abortaria tambien la escritura del otro canal; separarlas evita ese riesgo
 * y ademas dej a un fallo real de un canal sin arrastrar al otro, que de
 * todos modos se puede reintentar porque toda la operacion es idempotente.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; planKey: string }> }) {
  const auth = await requireRole(request, CONTENIDO);
  if (auth.error) return auth.error;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors[0]?.message ?? "Petición no válida." }, { status: 422 });

  const { id, planKey } = await params;
  // Solo los once pasos del recorrido: certification_offer y cualquier otra
  // clave viven fuera de este flujo.
  if (!TIMELINE_STEPS.some((step) => step.planKey === planKey)) {
    return NextResponse.json({ error: "Ese paso no existe.", errorCode: "STEP_UNKNOWN" }, { status: 422 });
  }

  const canales = [...new Set(parsed.data.channels)];
  const entradas = canales.map((channel) => ({ channel, entry: planEntryFor(planKey, channel) }));
  const sinPlan = entradas.find((item) => !item.entry);
  if (sinPlan) {
    return NextResponse.json(
      { error: `Este paso no tiene plan estándar de ${sinPlan.channel === "EMAIL" ? "correo" : "WhatsApp"}.`, errorCode: "CHANNEL_NOT_AVAILABLE" },
      { status: 422 },
    );
  }

  const course = await prisma.course.findUnique({ where: { id }, include: { sessions: { orderBy: { startAt: "asc" } } } });
  if (!course) return NextResponse.json({ error: "No se encontró el curso." }, { status: 404 });

  const window = courseAutomationWindow(course, course.sessions);
  const existentes = await prisma.automationRule.findMany({
    where: { courseId: id, planKey, channel: { in: canales } },
    select: { id: true, channel: true, status: true },
  });
  const porCanal = new Map(existentes.map((rule) => [rule.channel, rule]));

  const created: string[] = [];
  const revived: string[] = [];
  const reactivated: string[] = [];
  const alreadyConfigured: string[] = [];

  for (const { channel, entry } of entradas) {
    if (!entry) continue; // ya se valido arriba; esta guarda es para TypeScript.
    const actual = porCanal.get(channel);
    const offsetMinutes = parsed.data.offsetMinutes ?? entry.offsetMinutes;
    const nextExecutionAt = nextFixedRuleExecution({ trigger: entry.trigger, offsetMinutes, startsAt: window.startsAt, endsAt: window.endsAt });
    const data = {
      name: entry.name,
      trigger: entry.trigger,
      offsetMinutes,
      subject: entry.subject,
      body: entry.body,
      status: "ACTIVE" as const,
      requiresStreamUrl: entry.requiresStreamUrl,
      enrollmentStatuses: entry.enrollmentStatuses,
      waTemplateName: entry.waTemplateName,
      waTemplateLanguage: entry.waTemplateLanguage,
      waTemplateBodyVars: entry.waTemplateBodyVars ?? undefined,
      waTemplateUrlVar: entry.waTemplateUrlVar,
      nextExecutionAt,
      // Creación y revivir desde ARCHIVED son las dos activaciones reales de
      // este endpoint: ambas fijan activatedAt fresco.
      activatedAt: new Date(),
    };

    if (!actual) {
      try {
        await prisma.automationRule.create({ data: { ...data, courseId: id, channel, planKey } });
        created.push(channel);
      } catch (error) {
        if (!esErrorDeUnicidad(error)) throw error;
        alreadyConfigured.push(channel);
      }
      continue;
    }

    if (actual.status === "ARCHIVED") {
      // Se habia borrado (con historial) y se vuelve a configurar: recibe
      // contenido fresco del plan estandar, no lo que tenia antes de archivarse.
      await prisma.automationRule.update({ where: { id: actual.id }, data: { ...data, planKey } });
      revived.push(channel);
      continue;
    }

    if (actual.status === "PAUSED") {
      /**
       * Reanuda el canal sin tocar su contenido: una tarjeta a medias (un
       * canal ACTIVE, el otro PAUSED en vez de inexistente) tambien cuenta
       * como "falta configurar" -ver blockedReason en course-timeline.ts- y
       * seleccionarla debe encender lo que falta, igual que si no existiera.
       * Pero a diferencia de crear o revivir, aqui SI hubo una configuracion
       * previa (asunto, cuerpo, plantilla, desfase): no se pisa con el plan
       * estandar, solo se reanuda.
       */
      await prisma.automationRule.update({ where: { id: actual.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
      reactivated.push(channel);
      continue;
    }

    // Ya hay una regla viva y activa para ese canal: no se toca ni se duplica.
    alreadyConfigured.push(channel);
  }

  /**
   * Se reconcilia siempre que se haya pedido AL MENOS un canal, no solo
   * cuando `created.length > 0 || revived.length > 0`: ese condicional era
   * el bug -si el reschedule original fallaba, un reintento encontraba la
   * regla YA creada (status ACTIVE, ahora en `alreadyConfigured`) y por eso
   * nunca volvía a intentar el recálculo-. El flag persistente cubre también
   * el reintento; nunca se revierte lo ya guardado si esto falla.
   */
  if (entradas.length > 0) await markCourseAutomationReconcilePending(prisma, id, "STEP_CONFIGURED");
  const reconciled = entradas.length > 0 ? await reconcileCourseDerivedState(id, auth.session) : null;

  await writeAudit({
    session: auth.session,
    action: "COURSE_COMMUNICATION_STEP_CONFIGURED",
    entityType: "Course",
    entityId: id,
    metadata: { planKey, created, revived, reactivated, alreadyConfigured, reprogramado: reconciled?.ok ?? false },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, planKey, created, revived, reactivated, alreadyConfigured, pending: reconciled ? !reconciled.ok : false });
}
