import { Prisma, type MessageChannel } from "@prisma/client";
import { automationRuleCanRun, courseAcceptsAutomations } from "@/lib/automation-eligibility";
import { calculateAutomationSchedule, ECUADOR_TIME_ZONE, supportsEnrollmentStatus } from "@/lib/automation-schedule";
import {
  courseCompletionMoment,
  lastSession,
  resolveCourseSessions,
  sessionLabel,
  upcomingSessions,
  type ResolvedCourseSession,
} from "@/lib/course-sessions";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  isWithinLiveWindow,
  MESSAGING_LIVE_FROM,
  outsideLiveWindowMessage,
  resolveMessagingWindow,
} from "@/lib/live-activation";
import { mustSimulateExternalIntegration } from "@/lib/runtime-environment";
import { EmailChannel } from "./channels/email";
import { WhatsAppChannel } from "./channels/whatsapp";
import type { MessageChannelAdapter, SendResult } from "./channels/types";
import { welcomeSequence, type Sequence } from "./sequences";

const MAX_ATTEMPTS = 5;
const DISPATCH_BATCH_SIZE = 50;
const DISPATCH_CONCURRENCY = 10;
const RESCHEDULE_BATCH_SIZE = 100;
/**
 * Tope duro de seguridad para no dejar una función sin salida ante un curso con
 * decenas de miles de inscripciones. Al alcanzarlo, la operación lo informa
 * (`truncated`) con el cursor para continuar; nunca se detiene en silencio.
 */
const RESCHEDULE_MAX_ENROLLMENTS = 5_000;

/**
 * Los adaptadores se construyen bajo demanda: la configuracion SMTP se lee en
 * el momento del envio, no al importar el modulo. Asi un cambio de variable en
 * Vercel se aplica sin depender del orden de carga.
 */
function buildChannel(channel: MessageChannel): MessageChannelAdapter {
  return channel === "EMAIL"
    ? new EmailChannel()
    : new WhatsAppChannel({
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      });
}

export function isMessagingSimulation(): boolean {
  return mustSimulateExternalIntegration(process.env.MESSAGING_MODE);
}

export function isAutomationEligibleContact(classification: string, consent: boolean) {
  return classification === "REAL" && consent;
}

export const TEMPLATE_VARIABLES = [
  "nombre", "apellido", "curso", "courseUrl", "moodleUrl", "asesor", "fecha",
  "hora", "modalidad", "enlace", "appUrl", "streamUrl", "bloqueEnlace",
  "fechaSesion", "horaSesion", "sesion",
] as const;

export function renderMessageTemplate(template: string, vars: Record<string, string>): string {
  const replaced = template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    TEMPLATE_VARIABLES.includes(key as (typeof TEMPLATE_VARIABLES)[number]) ? vars[key] ?? "" : match,
  );
  // Una variable vacia (por ejemplo el bloque de enlace) no debe dejar huecos.
  return replaced.replace(/\n{3,}/g, "\n\n").trim();
}

const dateFormatter = new Intl.DateTimeFormat("es-EC", { dateStyle: "long", timeZone: ECUADOR_TIME_ZONE });
const timeFormatter = new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: ECUADOR_TIME_ZONE });

function formatDate(value: Date | null | undefined) {
  return value ? dateFormatter.format(value) : "por confirmar";
}

function formatTime(value: Date | null | undefined) {
  return value ? timeFormatter.format(value) : "por confirmar";
}

type LeadVariables = { firstName: string | null; lastName: string | null; fullName: string; assignedToId: string | null };
type CourseVariables = { title: string; officialCourseUrl: string; moodleCourseUrl: string | null; startsAt: Date | null; modality: string | null };

function templateVariables(
  lead: LeadVariables,
  course: CourseVariables,
  session?: ResolvedCourseSession | null,
) {
  const reference = session?.startAt ?? course.startsAt;
  const streamUrl = session?.streamUrl ?? "";
  return {
    nombre: lead.firstName ?? lead.fullName.split(" ")[0] ?? lead.fullName,
    apellido: lead.lastName ?? "",
    curso: course.title,
    courseUrl: course.officialCourseUrl,
    moodleUrl: course.moodleCourseUrl ?? "",
    asesor: lead.assignedToId ? "tu asesor de R.A. Training" : "R.A. Training",
    fecha: formatDate(reference),
    hora: formatTime(reference),
    fechaSesion: formatDate(session?.startAt ?? reference),
    horaSesion: formatTime(session?.startAt ?? reference),
    sesion: session ? sessionLabel(session) : "",
    modalidad: course.modality ?? "por confirmar",
    enlace: course.moodleCourseUrl ?? course.officialCourseUrl,
    streamUrl,
    bloqueEnlace: streamUrl ? `Enlace de acceso:\n${streamUrl}` : "",
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
  };
}

export async function enqueueSequence(leadId: string, enrollmentId?: string, sequence: Sequence = welcomeSequence) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || !isAutomationEligibleContact(lead.classification, lead.consent)) return { enqueued: 0, excluded: true };
  const enrollment = enrollmentId
    ? await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { course: true } })
    : await prisma.enrollment.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" }, include: { course: true } });
  if (!enrollment) return { enqueued: 0 };
  const vars = templateVariables(lead, enrollment.course);
  let enqueued = 0;
  for (const step of sequence.steps) {
    const to = step.channel === "EMAIL" ? lead.email : lead.phone;
    if (!to) continue;
    try {
      await prisma.outboundMessage.create({
        data: {
          leadId, enrollmentId: enrollment.id, channel: step.channel, toAddress: to,
          subject: step.subject ? renderMessageTemplate(step.subject, vars) : null,
          body: renderMessageTemplate(step.body, vars), status: "PROGRAMADO",
          scheduledAt: new Date(Date.now() + step.delayHours * 3_600_000),
          sequenceKey: sequence.key, stepKey: step.key, isSimulation: isMessagingSimulation(),
        },
      });
      enqueued++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  return { enqueued };
}

const enrollmentWithSchedule = {
  lead: true,
  course: {
    include: {
      sessions: { orderBy: { startAt: "asc" } },
      automationRules: true,
    },
  },
} satisfies Prisma.EnrollmentInclude;

type ScheduleTarget = {
  /**
   * Sesion a la que queda ligado el mensaje. Determina `courseSessionId` y la
   * clave idempotente. La bienvenida no se liga a ninguna: es del curso, y
   * ligarla haria que borrar esa sesion cancelara la bienvenida.
   */
  session: ResolvedCourseSession | null;
  /**
   * Sesion cuyos datos se muestran en el texto. Para los recordatorios coincide
   * con `session`; para la bienvenida es la primera sesion futura, porque el
   * participante necesita saber cuando empieza aunque el mensaje salga hoy.
   */
  contentSession: ResolvedCourseSession | null;
  scheduledAt: Date;
  stepKey: string;
};

/**
 * Sesion que describe el contenido de un mensaje de curso (no de sesion).
 *
 * Se prefiere la primera sesion futura. Si ya pasaron todas se usa la primera
 * registrada: mostrar la fecha real del curso es mas util que "por confirmar",
 * y ademas conserva intacto el comportamiento de los cursos historicos, cuya
 * sesion virtual proviene de un `startsAt` que puede estar en el pasado.
 */
function courseContentSession(
  sessions: readonly ResolvedCourseSession[],
  now: Date,
): ResolvedCourseSession | null {
  return upcomingSessions(sessions, now)[0] ?? sessions[0] ?? null;
}

/**
 * Un mensaje pendiente puede actualizarse (cambio de fecha, enlace que aparece
 * despues). Uno ya enviado, fallido de forma definitiva o cancelado nunca se
 * reescribe: solo se conserva como historial.
 */
const REPROGRAMMABLE_STATUSES = ["PROGRAMADO", "OMITIDO"] as const;

async function upsertAutomationMessage(input: {
  leadId: string;
  enrollmentId: string;
  ruleId: string;
  channel: MessageChannel;
  toAddress: string;
  subject: string | null;
  body: string;
  scheduledAt: Date;
  sequenceKey: string;
  stepKey: string;
  courseSessionId: string | null;
  omitted: { code: string; message: string } | null;
}): Promise<"created" | "updated" | "unchanged"> {
  const identity = {
    leadId_enrollmentId_sequenceKey_stepKey: {
      leadId: input.leadId,
      enrollmentId: input.enrollmentId,
      sequenceKey: input.sequenceKey,
      stepKey: input.stepKey,
    },
  };
  const existing = await prisma.outboundMessage.findUnique({ where: identity, select: { id: true, status: true } });
  const status = input.omitted ? ("OMITIDO" as const) : ("PROGRAMADO" as const);
  const payload = {
    automationRuleId: input.ruleId,
    courseSessionId: input.courseSessionId,
    channel: input.channel,
    toAddress: input.toAddress,
    subject: input.subject,
    body: input.body,
    status,
    scheduledAt: input.scheduledAt,
    isSimulation: isMessagingSimulation(),
    errorCode: input.omitted?.code ?? null,
    errorMessage: input.omitted?.message ?? null,
    error: input.omitted?.message ?? null,
  };

  if (!existing) {
    try {
      await prisma.outboundMessage.create({
        data: { leadId: input.leadId, enrollmentId: input.enrollmentId, sequenceKey: input.sequenceKey, stepKey: input.stepKey, ...payload },
      });
      return "created";
    } catch (error) {
      // Otra ejecucion del cron gano la carrera: la clave unica hizo su trabajo.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "unchanged";
      throw error;
    }
  }
  if (!REPROGRAMMABLE_STATUSES.includes(existing.status as (typeof REPROGRAMMABLE_STATUSES)[number])) return "unchanged";
  await prisma.outboundMessage.update({ where: { id: existing.id }, data: payload });
  return "updated";
}

function scheduleTargets(
  rule: { trigger: string; offsetMinutes: number },
  sessions: readonly ResolvedCourseSession[],
  enrollmentId: string,
  registeredAt: Date,
  now: Date,
): ScheduleTarget[] {
  const baseKey = `enrollment:${enrollmentId}`;
  if (rule.trigger === "ON_REGISTRATION") {
    const scheduledAt = calculateAutomationSchedule({
      trigger: "ON_REGISTRATION",
      offsetMinutes: rule.offsetMinutes,
      registeredAt,
    });
    // La bienvenida sale al inscribirse, pero habla de la primera sesion futura:
    // el momento de envio y el contenido responden a preguntas distintas.
    return scheduledAt
      ? [{ session: null, contentSession: courseContentSession(sessions, now), scheduledAt, stepKey: baseKey }]
      : [];
  }
  if (rule.trigger === "BEFORE_COURSE") {
    // Un recordatorio por sesion. La clave vacia de la sesion virtual conserva
    // exactamente las claves idempotentes de los cursos de una sola fecha.
    return sessions.flatMap((session) => {
      const scheduledAt = calculateAutomationSchedule({
        trigger: "BEFORE_COURSE",
        offsetMinutes: rule.offsetMinutes,
        registeredAt,
        startsAt: session.startAt,
      });
      if (!scheduledAt) return [];
      return [{ session, contentSession: session, scheduledAt, stepKey: session.key ? `${baseKey}:session:${session.key}` : baseKey }];
    });
  }
  const final = lastSession(sessions);
  const completion = courseCompletionMoment(sessions);
  if (!final || !completion) return [];
  return [
    {
      session: final,
      contentSession: final,
      scheduledAt: new Date(completion.getTime() + Math.abs(rule.offsetMinutes) * 60_000),
      stepKey: baseKey,
    },
  ];
}

export type ScheduleAutomationsResult = {
  enqueued: number;
  updated: number;
  skipped: number;
  omitted: number;
  /** Reglas activas aplicables al curso en el momento de programar. */
  activeRules: number;
  /** Motivo técnico cuando no se generó nada. Ausente si sí se generó. */
  reason?: ScheduleSkipReason;
};

export type ScheduleSkipReason =
  | "ENROLLMENT_NOT_FOUND"
  | "CONTACT_EXCLUDED"
  | "COURSE_NOT_PUBLISHED"
  | "NO_ACTIVE_RULES"
  | "NO_APPLICABLE_RULES";

/** Traducción para el administrador. Nunca se muestra el código técnico solo. */
export const SCHEDULE_SKIP_MESSAGES: Record<ScheduleSkipReason, string> = {
  ENROLLMENT_NOT_FOUND: "No se encontró la inscripción al programar los mensajes.",
  CONTACT_EXCLUDED: "El contacto no recibe automatizaciones: debe estar clasificado como real y tener consentimiento registrado.",
  COURSE_NOT_PUBLISHED: "El curso no está publicado, así que no se programaron mensajes.",
  NO_ACTIVE_RULES: "El curso todavía no tiene automatizaciones activas. Aplica el plan estándar de correos y actívalo.",
  NO_APPLICABLE_RULES: "Hay automatizaciones activas, pero ninguna aplica a esta inscripción: revisa las fechas de las sesiones, el estado de la inscripción y la campaña asociada.",
};

export function describeScheduleResult(result: ScheduleAutomationsResult): string | null {
  if (result.reason) return SCHEDULE_SKIP_MESSAGES[result.reason];
  const total = result.enqueued + result.updated;
  if (total === 0 && result.omitted > 0) {
    return "Los mensajes quedaron omitidos: falta el enlace de transmisión de la sesión.";
  }
  return null;
}

/**
 * Programa (o reprograma) los mensajes automaticos de una inscripcion.
 *
 * Es idempotente: se puede llamar tantas veces como haga falta. Los mensajes ya
 * enviados no se tocan; los pendientes se recalculan con las fechas vigentes.
 */
export async function scheduleEnrollmentAutomations(
  enrollmentId: string,
  now = new Date(),
  options: { ruleIds?: string[]; allowPastDueMinutes?: number } = {},
): Promise<ScheduleAutomationsResult> {
  const empty = { enqueued: 0, updated: 0, skipped: 0, omitted: 0, activeRules: 0 };
  const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: enrollmentWithSchedule });
  if (!enrollment) return { ...empty, reason: "ENROLLMENT_NOT_FOUND" };
  if (!isAutomationEligibleContact(enrollment.lead.classification, enrollment.lead.consent)) {
    return { ...empty, reason: "CONTACT_EXCLUDED" };
  }
  // Solo se exige que el curso siga publicado. Cerrar inscripciones nuevas es
  // lo habitual cuando el curso está por empezar y no puede dejar sin
  // recordatorios a quienes ya están inscritos.
  if (!courseAcceptsAutomations(enrollment.course)) {
    return { ...empty, reason: "COURSE_NOT_PUBLISHED" };
  }

  const sessions = resolveCourseSessions(enrollment.course, enrollment.course.sessions);
  // El curso puede tener sus fechas solo en las sesiones: la elegibilidad se
  // evalua sobre el calendario efectivo, no sobre startsAt/endsAt heredados.
  const effectiveCourse = {
    isPublished: enrollment.course.isPublished,
    acceptsRegistrations: enrollment.course.acceptsRegistrations,
    startsAt: sessions[0]?.startAt ?? enrollment.course.startsAt,
    endsAt: courseCompletionMoment(sessions) ?? enrollment.course.endsAt,
  };
  const rules = enrollment.course.automationRules.filter(
    (rule) => rule.status === "ACTIVE" && (!options.ruleIds?.length || options.ruleIds.includes(rule.id)),
  );
  if (rules.length === 0) return { ...empty, reason: "NO_ACTIVE_RULES" };

  let enqueued = 0;
  let updated = 0;
  let skipped = 0;
  let omitted = 0;
  const oldestAllowed = new Date(now.getTime() - (options.allowPastDueMinutes ?? 0) * 60_000);

  for (const rule of rules) {
    if (!automationRuleCanRun(effectiveCourse, rule)) { skipped++; continue; }
    if (rule.campaignId && rule.campaignId !== enrollment.campaignId) { skipped++; continue; }
    if (!supportsEnrollmentStatus(rule.enrollmentStatuses, enrollment.status)) { skipped++; continue; }
    const toAddress = rule.channel === "EMAIL" ? enrollment.lead.email : enrollment.lead.phone;
    if (!toAddress) { skipped++; continue; }

    for (const target of scheduleTargets(rule, sessions, enrollment.id, enrollment.createdAt, now)) {
      // Nunca se programan recordatorios de sesiones que ya ocurrieron. No es un
      // fallo tecnico: se contabiliza como omitido del cálculo.
      if (rule.trigger !== "ON_REGISTRATION" && target.scheduledAt < oldestAllowed) { skipped++; continue; }
      const missingStreamUrl = rule.requiresStreamUrl && !target.contentSession?.streamUrl;
      const vars = templateVariables(enrollment.lead, enrollment.course, target.contentSession);
      const outcome = await upsertAutomationMessage({
        leadId: enrollment.leadId,
        enrollmentId: enrollment.id,
        ruleId: rule.id,
        channel: rule.channel,
        toAddress,
        subject: rule.subject ? renderMessageTemplate(rule.subject, vars) : null,
        body: renderMessageTemplate(rule.body, vars),
        scheduledAt: target.scheduledAt,
        sequenceKey: `automation:${rule.id}`,
        stepKey: target.stepKey,
        courseSessionId: target.session?.id ?? null,
        omitted: missingStreamUrl
          ? { code: "MISSING_STREAM_URL", message: "La sesión no tiene un enlace de transmisión configurado." }
          : null,
      });
      if (missingStreamUrl && outcome !== "unchanged") omitted++;
      else if (outcome === "created") enqueued++;
      else if (outcome === "updated") updated++;
      else skipped++;
    }
  }

  const produced = enqueued + updated + omitted;
  if (produced > 0) {
    await writeAudit({
      actorEmail: "automation",
      action: "AUTOMATION_MESSAGES_QUEUED",
      entityType: "Enrollment",
      entityId: enrollment.id,
      metadata: { enqueued, updated, omitted, skipped, activeRules: rules.length, courseId: enrollment.courseId, sessions: sessions.length, simulation: isMessagingSimulation() },
    });
    return { enqueued, updated, skipped, omitted, activeRules: rules.length };
  }
  // Había reglas activas y aun así no salió nada: es una condición funcional
  // que el administrador debe poder ver, no un silencio.
  await writeAudit({
    actorEmail: "automation",
    action: "AUTOMATION_NO_MESSAGES_SCHEDULED",
    entityType: "Enrollment",
    entityId: enrollment.id,
    result: "FAILURE",
    metadata: { reason: "NO_APPLICABLE_RULES", activeRules: rules.length, skipped, courseId: enrollment.courseId, sessions: sessions.length },
  });
  return { enqueued, updated, skipped, omitted, activeRules: rules.length, reason: "NO_APPLICABLE_RULES" };
}

/**
 * Cancela los recordatorios pendientes que apuntan a sesiones eliminadas.
 * El historial de lo ya enviado se conserva intacto.
 */
async function cancelOrphanSessionMessages(courseId: string) {
  const sessions = await prisma.courseSession.findMany({ where: { courseId }, select: { id: true } });
  const validIds = sessions.map((session) => session.id);
  const result = await prisma.outboundMessage.updateMany({
    where: {
      status: "PROGRAMADO",
      enrollment: { courseId },
      courseSessionId: { not: null, ...(validIds.length ? { notIn: validIds } : {}) },
    },
    data: { status: "CANCELADO", cancelledAt: new Date(), errorCode: "SESSION_REMOVED", errorMessage: "La sesión asociada dejó de existir." },
  });
  return result.count;
}

/**
 * Recalcula los recordatorios de todas las inscripciones de un curso. Se usa al
 * cambiar fechas, sesiones o el enlace de transmision.
 *
 * Recorre las inscripciones por lotes con cursor sobre `id`: no carga todo en
 * memoria y no se detiene en un tope arbitrario. Si se alcanza el limite duro
 * de seguridad, lo informa con `truncated` y el cursor para continuar, en lugar
 * de dejar inscripciones sin recordatorio en silencio.
 */
export async function rescheduleCourseAutomations(courseId: string, now = new Date()) {
  const cancelled = await cancelOrphanSessionMessages(courseId);
  const totals = {
    enrollments: 0,
    enqueued: 0,
    updated: 0,
    omitted: 0,
    cancelled,
    batches: 0,
    truncated: false,
    nextCursor: null as string | null,
  };
  let cursor: string | undefined;

  while (totals.enrollments < RESCHEDULE_MAX_ENROLLMENTS) {
    const batch = await prisma.enrollment.findMany({
      where: { courseId, status: { not: "CANCELADO" }, lead: { classification: "REAL", consent: true } },
      select: { id: true },
      take: RESCHEDULE_BATCH_SIZE,
      // El cursor va sobre `id` (unico y estable): dos inscripciones creadas en
      // el mismo instante no pueden hacer que un lote se repita ni se salte.
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    for (const enrollment of batch) {
      const result = await scheduleEnrollmentAutomations(enrollment.id, now);
      totals.enrollments++;
      totals.enqueued += result.enqueued;
      totals.updated += result.updated;
      totals.omitted += result.omitted;
    }
    totals.batches++;
    cursor = batch[batch.length - 1].id;
    if (batch.length < RESCHEDULE_BATCH_SIZE) break;
  }

  if (totals.enrollments >= RESCHEDULE_MAX_ENROLLMENTS) {
    const remaining = await prisma.enrollment.count({
      where: {
        courseId,
        status: { not: "CANCELADO" },
        lead: { classification: "REAL", consent: true },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
    });
    if (remaining > 0) {
      totals.truncated = true;
      totals.nextCursor = cursor ?? null;
    }
  }

  await writeAudit({
    actorEmail: "automation",
    action: "AUTOMATION_COURSE_RESCHEDULED",
    entityType: "Course",
    entityId: courseId,
    result: totals.truncated ? "FAILURE" : "SUCCESS",
    metadata: totals,
  });
  return totals;
}

/**
 * Detiene lo pendiente conservando el historial. Se usa al archivar un contacto
 * o al cancelar una inscripcion: los mensajes ya enviados no se tocan.
 */
export async function cancelPendingMessages(
  scope: { leadId?: string; enrollmentId?: string },
  reason: { code: string; message: string },
) {
  if (!scope.leadId && !scope.enrollmentId) return { cancelled: 0 };
  const result = await prisma.outboundMessage.updateMany({
    where: { ...scope, status: "PROGRAMADO" },
    data: { status: "CANCELADO", cancelledAt: new Date(), errorCode: reason.code, errorMessage: reason.message },
  });
  return { cancelled: result.count };
}

export async function processDueAutomationRules(now = new Date()) {
  const rules = await prisma.automationRule.findMany({
    where: {
      status: "ACTIVE",
      trigger: { in: ["BEFORE_COURSE", "AFTER_COURSE"] },
      nextExecutionAt: { lte: now, gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      // Basta con que el curso siga publicado: cerrar inscripciones nuevas no
      // puede apagar los recordatorios de quienes ya están inscritos.
      course: { isPublished: true },
    },
    select: { id: true, courseId: true },
    take: 25,
  });
  let enrollments = 0;
  let enqueued = 0;
  for (const rule of rules) {
    const candidates = await prisma.enrollment.findMany({
      where: { courseId: rule.courseId, lead: { classification: "REAL", consent: true } },
      select: { id: true },
      take: 500,
    });
    for (const enrollment of candidates) {
      const result = await scheduleEnrollmentAutomations(enrollment.id, now, { ruleIds: [rule.id], allowPastDueMinutes: 1440 });
      enrollments++;
      enqueued += result.enqueued;
    }
    await prisma.automationRule.update({ where: { id: rule.id }, data: { nextExecutionAt: null } });
  }
  return { rules: rules.length, enrollments, enqueued };
}

export function retryDelayMinutes(attemptCount: number) {
  return Math.min(240, 5 * (2 ** Math.max(0, attemptCount - 1)));
}

function retryAt(attemptCount: number, now = new Date()) {
  const minutes = retryDelayMinutes(attemptCount);
  return new Date(now.getTime() + minutes * 60_000);
}

function failureData(result: SendResult, attemptCount: number, now: Date) {
  const exhausted = attemptCount >= MAX_ATTEMPTS;
  return {
    status: "FALLIDO" as const,
    failedAt: now,
    error: result.error?.slice(0, 500) ?? "No se pudo enviar.",
    errorCode: result.errorCode?.slice(0, 120) ?? "PROVIDER_ERROR",
    errorMessage: result.error?.slice(0, 500) ?? "No se pudo enviar.",
    providerName: result.providerName,
    providerResponse: result.providerResponse as Prisma.InputJsonValue | undefined,
    nextAttemptAt: exhausted ? null : retryAt(attemptCount, now),
  };
}

export async function sendMessage(messageId: string) {
  const now = new Date();
  // La ventana se comprueba antes de reclamar el mensaje: un mensaje bloqueado
  // no cambia de estado, sigue visible como PROGRAMADO y puede cancelarse o
  // reprogramarse desde el panel.
  const window = resolveMessagingWindow();
  if (window.state === "blocked") {
    return { ok: false, errorCode: window.errorCode, error: window.error };
  }
  const scheduled = await prisma.outboundMessage.findUnique({ where: { id: messageId }, select: { scheduledAt: true } });
  if (!scheduled) return { ok: false, error: "Mensaje no encontrado." };
  if (!isWithinLiveWindow(window, scheduled.scheduledAt)) {
    return { ok: false, errorCode: "BEFORE_LIVE_FROM", error: outsideLiveWindowMessage(window, MESSAGING_LIVE_FROM) };
  }

  const claimed = await prisma.outboundMessage.updateMany({
    where: {
      id: messageId,
      OR: [
        { status: "PROGRAMADO", scheduledAt: { lte: now } },
        { status: "FALLIDO", attemptCount: { lt: MAX_ATTEMPTS }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    data: { status: "ENVIANDO", attempts: { increment: 1 }, attemptCount: { increment: 1 }, lastAttemptAt: now, error: null, errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) return { ok: false, error: "El mensaje ya fue procesado o todavía no corresponde reintentarlo." };

  const message = await prisma.outboundMessage.findUnique({ where: { id: messageId }, include: { lead: true } });
  if (!message) return { ok: false, error: "Mensaje no encontrado." };
  if (!isAutomationEligibleContact(message.lead.classification, message.lead.consent)) {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { status: "OMITIDO", errorCode: "CONTACT_EXCLUDED", errorMessage: "Contacto de prueba, demostración, sin clasificar o sin consentimiento." } });
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "CONTACT_EXCLUDED", classification: message.lead.classification, consent: message.lead.consent } });
    return { ok: true, skipped: true };
  }
  if (isMessagingSimulation()) {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { status: "SIMULADO", isSimulation: true, nextAttemptAt: null, error: null } });
    if (message.automationRuleId) {
      await prisma.automationRule.update({ where: { id: message.automationRuleId }, data: { lastExecutedAt: now } }).catch(() => undefined);
    }
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_SIMULATED", entityType: "OutboundMessage", entityId: message.id, metadata: { channel: message.channel, externalRequestPerformed: false } });
    return { ok: true, simulated: true };
  }

  const result = await buildChannel(message.channel).send({ to: message.toAddress, subject: message.subject ?? undefined, body: message.body });
  const completedAt = new Date();
  await prisma.outboundMessage.update({
    where: { id: message.id },
    data: result.ok && !result.simulated
      ? {
          status: "ACEPTADO", acceptedAt: result.acceptedAt ?? completedAt,
          providerName: result.providerName, providerMessageId: result.providerMessageId,
          providerResponse: result.providerResponse as Prisma.InputJsonValue | undefined,
          isSimulation: false, nextAttemptAt: null, error: null, errorCode: null, errorMessage: null,
        }
      : result.simulated
        ? { status: "SIMULADO", isSimulation: true, nextAttemptAt: null, error: null }
        : failureData(result, message.attemptCount, completedAt),
  });
  if (message.automationRuleId) {
    await prisma.automationRule.update({ where: { id: message.automationRuleId }, data: { lastExecutedAt: completedAt } }).catch(() => undefined);
  }
  await writeAudit({
    actorEmail: "automation",
    action: result.ok ? "MESSAGE_PROVIDER_ACCEPTED" : "MESSAGE_PROVIDER_FAILED",
    entityType: "OutboundMessage",
    entityId: message.id,
    result: result.ok ? "SUCCESS" : "FAILURE",
    metadata: { channel: message.channel, provider: result.providerName, providerMessageIdPresent: Boolean(result.providerMessageId), errorCode: result.errorCode, attemptCount: message.attemptCount },
  });
  return result;
}

/**
 * Envia sin esperar al cron los mensajes de una inscripcion cuya hora ya llego.
 *
 * El negocio pide que la confirmacion salga en el momento de inscribirse; el
 * reloj corre cada cinco minutos y eso no es "inmediato". Solo procesa esta
 * inscripcion y esta acotado, para no convertir una petición pública en un
 * procesamiento de cola.
 */
export async function sendDueMessagesForEnrollment(enrollmentId: string, now = new Date()) {
  const pending = await prisma.outboundMessage.findMany({
    where: { enrollmentId, status: "PROGRAMADO", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 3,
    select: { id: true },
  });
  const settled = await Promise.allSettled(pending.map((message) => sendMessage(message.id)));
  return {
    processed: settled.length,
    succeeded: settled.filter((result) => result.status === "fulfilled" && result.value.ok).length,
  };
}

export async function processScheduledMessages(now = new Date()) {
  // Un canal en live sin fecha de activación no procesa nada: falla de forma
  // segura y lo dice, en lugar de vaciar la cola atrasada sobre los contactos.
  const window = resolveMessagingWindow();
  if (window.state === "blocked") {
    await writeAudit({
      actorEmail: "automation",
      action: "MESSAGE_DISPATCH_BLOCKED",
      entityType: "OutboundMessage",
      result: "FAILURE",
      metadata: { errorCode: window.errorCode, variable: MESSAGING_LIVE_FROM },
    });
    return { blocked: true, errorCode: window.errorCode, error: window.error, automations: null, processed: 0, succeeded: 0, failed: 0, results: [] };
  }
  const automations = await processDueAutomationRules(now);
  const liveFrom = window.state === "live" ? { scheduledAt: { gte: window.liveFrom } } : {};
  const pending = await prisma.outboundMessage.findMany({
    where: {
      AND: [
        liveFrom,
        {
          OR: [
            { status: "PROGRAMADO", scheduledAt: { lte: now } },
            { status: "FALLIDO", attemptCount: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { nextAttemptAt: "asc" }],
    take: DISPATCH_BATCH_SIZE,
    select: { id: true },
  });
  const results: Array<{ id: string; ok: boolean; error?: string; simulated?: boolean; skipped?: boolean }> = [];
  for (let index = 0; index < pending.length; index += DISPATCH_CONCURRENCY) {
    const chunk = pending.slice(index, index + DISPATCH_CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map((message) => sendMessage(message.id)));
    settled.forEach((result, itemIndex) => {
      const id = chunk[itemIndex].id;
      results.push(result.status === "fulfilled" ? { id, ...result.value } : { id, ok: false, error: "Fallo interno aislado durante el procesamiento." });
    });
  }
  return { blocked: false, errorCode: null, error: null, automations, processed: results.length, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, results };
}
