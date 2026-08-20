import { Prisma, type MessageChannel } from "@prisma/client";
import { automationRuleCanRun, courseAcceptsAutomations } from "@/lib/automation-eligibility";
import { courseAccessEligibility, ESTADO_PAGO_VERIFICADO, momentoAplicaAlCurso } from "@/lib/commerce/course-entitlement";
import { automatizacionPermitida, esMomentoOperativo } from "@/lib/whatsapp/conversation";
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
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";
import { resolveWhatsAppConfig, resolveWhatsAppWindow, toWhatsAppRecipient, WHATSAPP_LIVE_FROM } from "@/lib/whatsapp/config";
import { buildTemplateComponents, templateBindingOf } from "@/lib/whatsapp/templates";
import { EmailChannel } from "./channels/email";
import { WhatsAppChannel } from "./channels/whatsapp";
import type { MessageChannelAdapter, SendResult } from "./channels/types";
import { REPROGRAMMABLE_STATUSES } from "./queue-safety";
import { welcomeSequence, type Sequence } from "./sequences";

export const MAX_ATTEMPTS = 5;
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
  if (channel === "EMAIL") return new EmailChannel();
  const config = resolveWhatsAppConfig();
  return new WhatsAppChannel({
    phoneNumberId: config.phoneNumberId,
    accessToken: config.accessToken,
    graphVersion: config.graphVersion,
  });
}

export function isMessagingSimulation(): boolean {
  return mustSimulateExternalIntegration(process.env.MESSAGING_MODE);
}

/**
 * Ventana de activacion del canal concreto.
 *
 * Correo y WhatsApp compartian `MESSAGING_MODE`, de modo que tocar uno ponia
 * en juego el otro. Separarlos no es una comodidad: el correo ya opera en real
 * y ninguna maniobra sobre WhatsApp deberia poder apagarlo.
 */
export function resolveChannelWindow(channel: MessageChannel, env: NodeJS.ProcessEnv = process.env) {
  return channel === "WHATSAPP" ? resolveWhatsAppWindow(env) : resolveMessagingWindow(env);
}

export function channelLiveFromVariable(channel: MessageChannel): string {
  return channel === "WHATSAPP" ? WHATSAPP_LIVE_FROM : MESSAGING_LIVE_FROM;
}

/** ¿Este canal simula? WhatsApp tiene su propio interruptor. */
export function isChannelSimulation(channel: MessageChannel, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveChannelWindow(channel, env).state === "simulation";
}

export function isAutomationEligibleContact(classification: string, consent: boolean) {
  return classification === "REAL" && consent;
}

// La lista canonica vive en `lib/template-variables`, que no depende del
// servidor y por tanto puede importarse tambien desde el panel. Se reexporta
// para no romper a quien ya la importaba desde aqui.
export { TEMPLATE_VARIABLES };

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
type CourseVariables = {
  title: string;
  officialCourseUrl: string;
  courseCompleteUrl: string | null;
  whatsappGroupUrl: string | null;
  surveyUrl: string | null;
  moodleCourseUrl: string | null;
  startsAt: Date | null;
  modality: string | null;
};

/**
 * Sesion siguiente a la dada dentro del calendario real del curso.
 *
 * Devuelve `null` cuando la sesion es la ultima: no hay nada despues, y una
 * fecha inventada es peor que ninguna.
 */
function nextSessionAfter(
  session: ResolvedCourseSession | null | undefined,
  sessions: readonly ResolvedCourseSession[],
): ResolvedCourseSession | null {
  if (!session) return null;
  return sessions.find((candidate) => candidate.position === session.position + 1) ?? null;
}

function templateVariables(
  lead: LeadVariables,
  course: CourseVariables,
  session?: ResolvedCourseSession | null,
  sessions: readonly ResolvedCourseSession[] = session ? [session] : [],
) {
  const reference = session?.startAt ?? course.startsAt;
  const streamUrl = session?.streamUrl ?? "";
  const sessionName = session ? sessionLabel(session) : "";
  const next = nextSessionAfter(session, sessions);
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
    sesion: sessionName,
    sesion_actual: sessionName,
    // Numero desnudo, no frase: la plantilla registrada en Meta ya escribe
    // "Sesión {{3}} de {{4}}" alrededor, asi que devolver "Sesión 1" produciria
    // "Sesión Sesión 1 de 3" en el telefono del contacto.
    numero_sesion: session ? String(session.position) : "",
    total_sesiones: session ? String(session.totalSessions) : "",
    // Fecha real de la sesion siguiente. Vacia si no hay siguiente: el unico
    // mensaje que la usa no se programa en la ultima sesion.
    proxima_sesion: next ? formatDate(next.startAt) : "",
    modalidad: course.modality ?? "por confirmar",
    enlace: course.moodleCourseUrl ?? course.officialCourseUrl,
    streamUrl,
    link_reunion: streamUrl,
    link_grupo_whatsapp: course.whatsappGroupUrl ?? "",
    link_curso_completo: course.courseCompleteUrl ?? "",
    link_encuesta: course.surveyUrl ?? "",
    bloqueEnlace: streamUrl ? `Enlace de acceso:\n${streamUrl}` : "",
    // Un curso sin calendario no debe mostrar «Fecha: por confirmar» seguido de
    // «Hora: por confirmar»: es ruido que no aporta nada. Mejor omitir el bloque.
    bloqueFecha: reference
      ? `Fecha: ${formatDate(reference)}\nHora: ${formatTime(reference)}${course.modality ? `\nModalidad: ${course.modality}` : ""}`
      : "",
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
  // Hacen falta para decidir el derecho de acceso: en un curso de pago, el
  // journey no existe hasta que una de ellas esta verificada.
  purchases: { select: { status: true } },
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
  legacySequenceKey?: string;
  stepKey: string;
  courseSessionId: string | null;
  waTemplate: Prisma.InputJsonValue | null;
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
  const existing = await prisma.outboundMessage.findUnique({ where: identity, select: { id: true, status: true } })
    ?? (input.legacySequenceKey
      ? await prisma.outboundMessage.findUnique({
          where: {
            leadId_enrollmentId_sequenceKey_stepKey: {
              leadId: input.leadId,
              enrollmentId: input.enrollmentId,
              sequenceKey: input.legacySequenceKey,
              stepKey: input.stepKey,
            },
          },
          select: { id: true, status: true },
        })
      : null);
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
    waTemplate: input.waTemplate ?? Prisma.DbNull,
    isSimulation: isChannelSimulation(input.channel),
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
  await prisma.outboundMessage.update({ where: { id: existing.id }, data: { sequenceKey: input.sequenceKey, stepKey: input.stepKey, ...payload } });
  return "updated";
}

/** Exportada para poder fijar en pruebas el calendario de los 11 momentos. */
export function scheduleTargets(
  rule: { trigger: string; offsetMinutes: number; planKey?: string | null },
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
  /**
   * Avisos que ocurren UNA VEZ POR SESION, no una vez por curso.
   *
   *   late_access -> se cuenta desde que la sesion EMPIEZA (quien llega tarde).
   *   thank_you   -> se cuenta desde que la sesion TERMINA (cierre de sesion).
   *
   * `thank_you` caia antes en el bloque final, que solo produce un objetivo
   * medido desde el fin del curso. En un curso de tres sesiones eso significaba
   * un unico "fin de sesion" al terminar la tercera, y ningun cierre en la
   * primera ni en la segunda, que son justo las que deben anunciar cual es la
   * siguiente.
   */
  if (rule.trigger === "AFTER_COURSE" && (rule.planKey === "late_access" || rule.planKey === "thank_you")) {
    const esCierre = rule.planKey === "thank_you";
    return sessions.flatMap((session) => {
      /**
       * El cierre anuncia la sesion siguiente ("La siguiente sesión está
       * programada para..."), asi que despues de la ultima no tiene nada que
       * decir. Se omite en lugar de salir con la fecha vacia; el cierre del
       * curso entero lo cubren `course_complete` y `survey`.
       *
       * Los rezagados si salen en todas: quien llega tarde necesita el enlace
       * tambien en la ultima sesion.
       */
      if (esCierre && !nextSessionAfter(session, sessions)) return [];
      const referencia = esCierre ? (session.endAt ?? session.startAt) : session.startAt;
      return [{
        session,
        contentSession: session,
        scheduledAt: new Date(referencia.getTime() + Math.abs(rule.offsetMinutes) * 60_000),
        stepKey: session.key ? `${baseKey}:session:${session.key}` : baseKey,
      }];
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

type WhatsAppRuleFields = {
  channel: MessageChannel;
  waTemplateName: string | null;
  waTemplateLanguage: string | null;
  waTemplateBodyVars: unknown;
  waTemplateUrlVar: string | null;
};

/**
 * Resuelve la plantilla de una regla de WhatsApp.
 *
 * Esta funcion es el punto donde se hace estructuralmente imposible que un
 * mensaje iniciado por la empresa salga como texto libre. Una regla de WhatsApp
 * sin plantilla no produce un mensaje "de texto": produce un mensaje OMITIDO
 * con el motivo escrito. Meta lo rechazaria igualmente, y descubrirlo al
 * programar es mucho mejor que descubrirlo cuando la sesion esta por empezar.
 */
export function resolveWhatsAppTemplate(
  rule: WhatsAppRuleFields,
  vars: Record<string, string>,
): { payload: Prisma.InputJsonValue | null; problem: { code: string; message: string } | null } {
  if (rule.channel !== "WHATSAPP") return { payload: null, problem: null };
  const binding = templateBindingOf(rule);
  if (!binding) {
    return {
      payload: null,
      problem: {
        code: "WHATSAPP_TEMPLATE_MISSING",
        message: "La regla de WhatsApp no tiene plantilla aprobada asignada. Meta rechaza el texto libre en mensajes iniciados por la empresa, así que el mensaje no se programa.",
      },
    };
  }
  const built = buildTemplateComponents(binding, vars);
  if (!built.ok) {
    return { payload: null, problem: { code: built.errorCode, message: built.error } };
  }
  return {
    payload: { name: binding.name, language: binding.language, components: built.components } as Prisma.InputJsonValue,
    problem: null,
  };
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
  | "ENROLLMENT_CANCELLED"
  | "ENROLLMENT_COMPLETED"
  | "CONTACT_EXCLUDED"
  | "COURSE_NOT_PUBLISHED"
  | "COURSE_NOT_ENTITLED"
  | "NO_ACTIVE_RULES"
  | "NO_APPLICABLE_RULES";

/** Traducción para el administrador. Nunca se muestra el código técnico solo. */
export const SCHEDULE_SKIP_MESSAGES: Record<ScheduleSkipReason, string> = {
  ENROLLMENT_NOT_FOUND: "No se encontró la inscripción al programar los mensajes.",
  ENROLLMENT_CANCELLED: "La inscripción está cancelada, así que no recibe nuevos mensajes.",
  ENROLLMENT_COMPLETED: "La inscripcion ya finalizo, asi que no recibe nuevos mensajes automaticos de este curso.",
  CONTACT_EXCLUDED: "El contacto no recibe automatizaciones: debe estar clasificado como real y tener consentimiento registrado.",
  COURSE_NOT_PUBLISHED: "El curso no está publicado, así que no se programaron mensajes.",
  COURSE_NOT_ENTITLED: "El curso es de pago y todavía no hay un pago verificado, así que no se programaron mensajes. Se programarán solos al verificar el pago.",
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
  if (enrollment.status === "CANCELADO") return { ...empty, reason: "ENROLLMENT_CANCELLED" };
  if (enrollment.status === "COMPLETADO") return { ...empty, reason: "ENROLLMENT_COMPLETED" };
  if (!isAutomationEligibleContact(enrollment.lead.classification, enrollment.lead.consent)) {
    return { ...empty, reason: "CONTACT_EXCLUDED" };
  }
  // Solo se exige que el curso siga publicado. Cerrar inscripciones nuevas es
  // lo habitual cuando el curso está por empezar y no puede dejar sin
  // recordatorios a quienes ya están inscritos.
  if (!courseAcceptsAutomations(enrollment.course)) {
    return { ...empty, reason: "COURSE_NOT_PUBLISHED" };
  }
  /**
   * Paid first: en un curso de pago el journey no empieza al registrarse, sino
   * cuando el pago queda verificado.
   *
   * Se comprueba aqui, antes de crear nada, y no solo al enviar: un mensaje
   * programado para quien no ha pagado es una fecha que alguien puede mirar y
   * dar por buena. Cuando el pago se verifique, esta misma funcion se vuelve a
   * llamar y programa el journey completo; la idempotencia de siempre impide
   * que se dupliquen.
   */
  const acceso = courseAccessEligibility(enrollment.course, enrollment, enrollment.purchases);
  if (!acceso.habilitado) {
    return { ...empty, reason: "COURSE_NOT_ENTITLED" };
  }

  /**
   * Atencion humana en curso: los momentos comerciales de ESTA persona se
   * callan para no hablar encima del asesor. Los operativos siguen, porque
   * quedarse sin el enlace de la sesion por haber escrito una duda seria un
   * dano mucho mayor que un comercial de mas.
   *
   * Se consulta una vez por inscripcion, no por regla: son once reglas y la
   * respuesta es la misma para todas.
   */
  const conversacion = enrollment.lead.phone
    ? await prisma.conversation.findUnique({ where: { phone: enrollment.lead.phone }, select: { state: true } })
    : null;

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
    // El cierre y el seguimiento hablan de "esta capacitación gratuita": en un
    // curso de pago le dirian a quien acaba de pagar que lo suyo era gratis.
    if (!momentoAplicaAlCurso(rule.planKey, enrollment.course)) { skipped++; continue; }
    if (!automatizacionPermitida(conversacion?.state, rule.planKey)) { skipped++; continue; }
    if (rule.campaignId && rule.campaignId !== enrollment.campaignId) { skipped++; continue; }
    if (!supportsEnrollmentStatus(rule.enrollmentStatuses, enrollment.status)) { skipped++; continue; }
    /**
     * Una regla de bienvenida que no llevaba activa desde antes de la
     * inscripcion no saluda hacia atras.
     *
     * La bienvenida esta exenta del filtro de fechas pasadas (debe salir
     * aunque se programe con retraso), asi que sin esta guarda dos casos
     * reenviarian "tu inscripcion fue registrada" semanas despues:
     *
     *   1. Aplicar el plan estandar a un curso con inscritos (regla NUEVA).
     *   2. Reactivar un paso que estuvo pausado desde antes de que alguien se
     *      inscribiera (regla VIEJA, pero recien vuelta a ACTIVE). Con esa
     *      inscripcion nunca llego a crearse un mensaje —la regla pausada ni
     *      se considera al registrarse— asi que comparar solo con
     *      `rule.createdAt` no la protegia: la regla ya existia desde antes.
     *
     * Production comparaba contra `rule.updatedAt` (nunca anterior a
     * `createdAt`, asi que esa guarda solo podia volverse MAS estricta,
     * jamas menos). `activatedAt` la refina: editar el texto o el horario de
     * una regla ya ACTIVE no lo mueve, asi que una correccion de copy no
     * vuelve a silenciar la bienvenida de inscripciones anteriores a esa
     * edicion. Solo una activacion real (creacion, o retorno desde
     * PAUSED/DRAFT/ARCHIVED) lo actualiza.
     *
     * Si `activatedAt` faltara por cualquier motivo (dato legacy, una fila
     * que escapo del backfill), se cae a `updatedAt` -la frontera que
     * Production ya usaba- en vez de tratar null como "sin limite": omitir
     * una bienvenida de mas es un problema menor y reversible manualmente;
     * mandarla de mas no se puede deshacer.
     */
    const activationBoundary = rule.activatedAt ?? rule.updatedAt;
    if (rule.trigger === "ON_REGISTRATION" && enrollment.createdAt < activationBoundary) { skipped++; continue; }
    const toAddress = rule.channel === "EMAIL" ? enrollment.lead.email : enrollment.lead.phone;
    if (!toAddress) { skipped++; continue; }

    for (const target of scheduleTargets(rule, sessions, enrollment.id, enrollment.createdAt, now)) {
      // Nunca se programan recordatorios de sesiones que ya ocurrieron. No es un
      // fallo tecnico: se contabiliza como omitido del cálculo.
      if (rule.trigger !== "ON_REGISTRATION" && target.scheduledAt < oldestAllowed) { skipped++; continue; }
      const missingStreamUrl = rule.requiresStreamUrl && !target.contentSession?.streamUrl;
      const vars = templateVariables(enrollment.lead, enrollment.course, target.contentSession, sessions);
      const missingWhatsappGroupUrl = (rule.planKey === "whatsapp_group" || rule.body.includes("{{link_grupo_whatsapp}}")) && !vars.link_grupo_whatsapp;
      /**
       * El seguimiento tambien depende del enlace, aunque no lo incluya.
       *
       * `course_follow_up` es el seguimiento DE la oferta del curso completo.
       * Si el mensaje que presenta esa oferta quedo bloqueado por falta de
       * enlace, el seguimiento llegaria hablando de algo que la persona nunca
       * recibio. Se bloquean los dos juntos y se desbloquean juntos.
       */
      const missingCourseCompleteUrl =
        (rule.planKey === "course_complete" || rule.planKey === "course_follow_up" || rule.body.includes("{{link_curso_completo}}"))
        && !vars.link_curso_completo;
      const missingSurveyUrl = (rule.planKey === "survey" || rule.body.includes("{{link_encuesta}}")) && !vars.link_encuesta;
      // WhatsApp resuelve aqui su plantilla, no al enviar: asi el mensaje
      // guarda exactamente lo que saldra, y un problema de plantilla se ve al
      // programar en lugar de descubrirse cuando ya no hay margen.
      const template = resolveWhatsAppTemplate(rule, vars);
      const blocked = missingStreamUrl
        ? { code: "MISSING_STREAM_URL", message: "La sesión no tiene un enlace de transmisión configurado." }
        : missingWhatsappGroupUrl
          ? { code: "MISSING_WHATSAPP_GROUP_URL", message: "El curso no tiene una URL de grupo de WhatsApp configurada." }
          : missingCourseCompleteUrl
            ? { code: "MISSING_COURSE_COMPLETE_URL", message: "El curso no tiene una URL informativa de curso completo configurada." }
            : missingSurveyUrl
              ? { code: "MISSING_SURVEY_URL", message: "El curso no tiene una URL de encuesta final configurada." }
              : template.problem;
      const outcome = await upsertAutomationMessage({
        leadId: enrollment.leadId,
        enrollmentId: enrollment.id,
        ruleId: rule.id,
        channel: rule.channel,
        toAddress,
        subject: rule.subject ? renderMessageTemplate(rule.subject, vars) : null,
        body: renderMessageTemplate(rule.body, vars),
        scheduledAt: target.scheduledAt,
        sequenceKey: `automation:${rule.channel}:${rule.planKey ?? rule.id}`,
        legacySequenceKey: `automation:${rule.id}`,
        stepKey: target.stepKey,
        courseSessionId: target.session?.id ?? null,
        waTemplate: template.payload,
        omitted: blocked,
      });
      if (blocked && outcome !== "unchanged") omitted++;
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
      where: { courseId, status: { notIn: ["CANCELADO", "COMPLETADO"] }, lead: { classification: "REAL", consent: true } },
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
        status: { notIn: ["CANCELADO", "COMPLETADO"] },
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

export async function finalizeCompletedCourseEnrollments(now = new Date()) {
  const candidates = await prisma.enrollment.findMany({
    where: {
      status: { in: ["INTERESADO", "INSCRITO", "EN_CURSO"] },
      course: { isPublished: true },
    },
    take: 200,
    include: { course: { include: { sessions: { orderBy: { startAt: "asc" } } } } },
  });
  let completed = 0;
  let cancelled = 0;
  for (const enrollment of candidates ?? []) {
  const sessions = resolveCourseSessions(enrollment.course, enrollment.course.sessions);
    const completedAt = courseCompletionMoment(sessions);
    if (!completedAt || completedAt > now) continue;
    const outboundMessageDelegate = prisma.outboundMessage as typeof prisma.outboundMessage & {
      count?: typeof prisma.outboundMessage.count;
    };
    const futureValid = outboundMessageDelegate.count
      ? await outboundMessageDelegate.count({
          where: { enrollmentId: enrollment.id, status: "PROGRAMADO", scheduledAt: { gt: now } },
        })
      : 0;
    if (futureValid > 0) continue;
    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { status: "COMPLETADO" } });
    /**
     * Se cancela TODO lo pendiente, no solo lo futuro.
     *
     * Este filtro llevaba `scheduledAt: { gt: now }`, de modo que un mensaje
     * cuya hora ya habia pasado sin llegar a salir sobrevivia a la
     * finalizacion del curso y quedaba en la cola como "listo para enviar"
     * indefinidamente. Ocurrio de verdad: 37 bienvenidas del 7 al 10 de agosto
     * seguian en cola despues de que el curso terminara el 13, y el panel
     * ofrecia enviarlas. La bienvenida esta exenta del filtro de fechas
     * pasadas —debe salir aunque se programe con retraso— pero esa excencion
     * deja de tener sentido cuando el curso al que da la bienvenida ya acabo.
     *
     * Un aviso que no salio a tiempo no se envia tarde: se cancela.
     */
    const pending = await prisma.outboundMessage.updateMany({
      where: { enrollmentId: enrollment.id, status: { in: ["PROGRAMADO", "OMITIDO"] } },
      data: {
        status: "CANCELADO",
        cancelledAt: now,
        nextAttemptAt: null,
        errorCode: "COURSE_COMPLETED",
        errorMessage: "El curso terminó antes de que este aviso pudiera salir, así que se canceló para no escribir fuera de tiempo.",
      },
    });
    completed++;
    cancelled += pending.count;
  }
  if (completed > 0) {
    await writeAudit({
      actorEmail: "automation",
      action: "COURSE_ENROLLMENTS_FINALIZED",
      entityType: "Enrollment",
      metadata: { completed, cancelled, preservedContacts: true, preservedHistory: true },
    });
  }
  return { completed, cancelled };
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
      where: { courseId: rule.courseId, status: { notIn: ["CANCELADO", "COMPLETADO"] }, lead: { classification: "REAL", consent: true } },
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

/**
 * Lectura defensiva de `waTemplate`. Es JSON libre en la base, asi que un valor
 * incompleto debe tratarse como ausencia de plantilla y no como una plantilla
 * a medias que Meta rechazaria.
 */
export function readStoredTemplate(raw: unknown): { name: string; language: string; components: unknown[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as { name?: unknown; language?: unknown; components?: unknown };
  if (typeof value.name !== "string" || !value.name.trim()) return null;
  if (typeof value.language !== "string" || !value.language.trim()) return null;
  if (!Array.isArray(value.components)) return null;
  return { name: value.name, language: value.language, components: value.components };
}

export function retryDelayMinutes(attemptCount: number) {
  return Math.min(240, 5 * (2 ** Math.max(0, attemptCount - 1)));
}

function retryAt(attemptCount: number, now = new Date()) {
  const minutes = retryDelayMinutes(attemptCount);
  return new Date(now.getTime() + minutes * 60_000);
}

function failureData(result: SendResult, attemptCount: number, now: Date) {
  // Un fallo permanente (plantilla inexistente, token revocado, numero no
  // valido) no mejora reintentando: se agotan los intentos de una vez para que
  // el motivo quede visible en lugar de repetirse durante cuatro horas.
  const exhausted = result.permanent === true || attemptCount >= MAX_ATTEMPTS;
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
  // reprogramarse desde el panel. Cada canal tiene la suya, de modo que
  // WhatsApp bloqueado no detiene el correo ni al reves.
  const scheduled = await prisma.outboundMessage.findUnique({ where: { id: messageId }, select: { scheduledAt: true, channel: true } });
  if (!scheduled) return { ok: false, error: "Mensaje no encontrado." };
  const window = resolveChannelWindow(scheduled.channel);
  if (window.state === "blocked") {
    return { ok: false, errorCode: window.errorCode, error: window.error };
  }
  if (!isWithinLiveWindow(window, scheduled.scheduledAt)) {
    return { ok: false, errorCode: "BEFORE_LIVE_FROM", error: outsideLiveWindowMessage(window, channelLiveFromVariable(scheduled.channel)) };
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

  const message = await prisma.outboundMessage.findUnique({
    where: { id: messageId },
    include: {
      lead: true,
      // Para volver a comprobar el derecho justo antes de enviar.
      enrollment: { include: { course: { select: { isFree: true, isPublished: true, automationsPausedAt: true } }, purchases: { select: { status: true } } } },
      automationRule: { select: { planKey: true, status: true } },
    },
  });
  if (!message) return { ok: false, error: "Mensaje no encontrado." };
  /**
   * Segunda comprobacion del derecho, ya con el mensaje reclamado.
   *
   * El programador ya impide crearlos, pero un mensaje puede haberse quedado
   * de antes, o el pago puede haberse cancelado despues de programarlo. Aqui
   * se falla cerrado: se marca OMITIDO con el motivo, en lugar de enviarlo.
   * Un curso gratuito no pasa por esto, porque su derecho es el registro.
   */
  if (message.enrollment) {
    const acceso = courseAccessEligibility(message.enrollment.course, message.enrollment, message.enrollment.purchases);
    if (!acceso.habilitado) {
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: "OMITIDO", errorCode: "COURSE_NOT_ENTITLED", errorMessage: `No se envió: ${acceso.etiqueta.toLowerCase()}.`, nextAttemptAt: null },
      });
      await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "COURSE_NOT_ENTITLED", motivo: acceso.motivo } });
      return { ok: true, skipped: true };
    }
    /**
     * Curso pausado DESPUES de programar este mensaje.
     *
     * El programador ya excluye los cursos pausados (`courseAcceptsAutomations`),
     * pero eso no toca lo que ya estaba en PROGRAMADO: sin este cerrojo, pausar
     * un curso no detenia lo que ya estaba en cola, contradiciendo lo que
     * promete el propio endpoint de pausa ("dejan de... salir mientras dure la
     * pausa"). OMITIDO y no CANCELADO: reanudar el curso lo recupera solo.
     */
    if (message.enrollment.course.automationsPausedAt) {
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: "OMITIDO", errorCode: "COURSE_AUTOMATIONS_PAUSED", errorMessage: "No se envió: las automatizaciones de este curso están en pausa.", nextAttemptAt: null },
      });
      await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "COURSE_AUTOMATIONS_PAUSED" } });
      return { ok: true, skipped: true };
    }
    /**
     * Curso despublicado DESPUES de programar este mensaje.
     *
     * Es la otra mitad de `courseAcceptsAutomations` (la pausa es la primera):
     * despublicar es la señal de que la actividad no va. El programador ya lo
     * excluye para mensajes nuevos; esto protege lo que ya estaba en cola.
     */
    if (!message.enrollment.course.isPublished) {
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: "OMITIDO", errorCode: "COURSE_UNPUBLISHED", errorMessage: "No se envió: el curso ya no está publicado.", nextAttemptAt: null },
      });
      await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "COURSE_UNPUBLISHED" } });
      return { ok: true, skipped: true };
    }
  }
  /**
   * La regla dejó de estar ACTIVE DESPUES de programar este mensaje.
   *
   * Pausar/archivar una regla ya pone sus PROGRAMADO en cuarentena en el
   * mismo momento (ver automations/[id] PATCH), pero esto es la unica otra
   * defensa si algun camino futuro cambiara el estado sin pasar por ahi: el
   * mismo codigo que ya usa esa cuarentena, para que el rastro sea identico
   * sin importar cual de las dos capas lo detuvo.
   */
  if (message.automationRuleId && message.automationRule?.status && message.automationRule.status !== "ACTIVE") {
    const inactiva = message.automationRule.status === "ARCHIVED"
      ? { code: "AUTOMATION_DISABLED", message: "No se envió: la automatización fue archivada.", cancel: true }
      : { code: "RULE_PAUSED", message: "No se envió: la automatización está pausada.", cancel: false };
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: inactiva.cancel
        ? { status: "CANCELADO", cancelledAt: now, errorCode: inactiva.code, errorMessage: inactiva.message }
        : { status: "OMITIDO", errorCode: inactiva.code, errorMessage: inactiva.message, nextAttemptAt: null },
    });
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: inactiva.code } });
    return { ok: true, skipped: true };
  }
  /**
   * Atencion humana abierta DESPUES de programar el mensaje.
   *
   * El filtro al programar no basta: un comercial pudo quedar en cola dias
   * antes de que la persona escribiera. Sin esta segunda puerta saldria igual y
   * hablaria encima del asesor.
   *
   * Los operativos si salen: quedarse sin el enlace de la propia sesion por
   * haber preguntado una duda seria un dano mucho mayor.
   */
  if (message.lead.phone && !esMomentoOperativo(message.automationRule?.planKey)) {
    const conversacion = await prisma.conversation.findUnique({
      where: { phone: message.lead.phone },
      select: { state: true },
    });
    if (!automatizacionPermitida(conversacion?.state, message.automationRule?.planKey)) {
      await prisma.outboundMessage.update({
        where: { id: message.id },
        // OMITIDO y no CANCELADO: no se envio, pero tampoco lo cancelo nadie.
        // El historial conserva que existio y por que se quedo fuera.
        data: { status: "OMITIDO", errorCode: "HUMAN_HANDOFF_ACTIVE", errorMessage: "No se envió: hay una atención humana abierta con este contacto.", nextAttemptAt: null },
      });
      await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "HUMAN_HANDOFF_ACTIVE", planKey: message.automationRule?.planKey ?? null } });
      return { ok: true, skipped: true };
    }
  }

  if (!isAutomationEligibleContact(message.lead.classification, message.lead.consent)) {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { status: "OMITIDO", errorCode: "CONTACT_EXCLUDED", errorMessage: "Contacto de prueba, demostración, sin clasificar o sin consentimiento." } });
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "CONTACT_EXCLUDED", classification: message.lead.classification, consent: message.lead.consent } });
    return { ok: true, skipped: true };
  }
  /**
   * Contacto archivado DESPUES de programar el mensaje.
   *
   * Archivar ya pone sus PROGRAMADO en cuarentena en el mismo momento (ver
   * leads/[id] PATCH); esto es la segunda defensa, con el mismo código que
   * usa esa cuarentena.
   */
  if (message.lead.isArchived) {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { status: "OMITIDO", errorCode: "CONTACT_ARCHIVED", errorMessage: "No se envió: el contacto está archivado.", nextAttemptAt: null } });
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "CONTACT_ARCHIVED" } });
    return { ok: true, skipped: true };
  }
  if (window.state === "simulation") {
    await prisma.outboundMessage.update({ where: { id: message.id }, data: { status: "SIMULADO", isSimulation: true, nextAttemptAt: null, error: null } });
    if (message.automationRuleId) {
      await prisma.automationRule.update({ where: { id: message.automationRuleId }, data: { lastExecutedAt: now } }).catch(() => undefined);
    }
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_SIMULATED", entityType: "OutboundMessage", entityId: message.id, metadata: { channel: message.channel, externalRequestPerformed: false } });
    return { ok: true, simulated: true };
  }

  // Segundo cerrojo contra el texto libre. El primero esta al programar; este
  // cubre los mensajes creados antes de que existiera la comprobacion y
  // cualquier ruta que llegue aqui sin pasar por el programador.
  const template = readStoredTemplate(message.waTemplate);
  if (message.channel === "WHATSAPP" && !template) {
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: {
        status: "OMITIDO", nextAttemptAt: null,
        errorCode: "WHATSAPP_TEMPLATE_MISSING",
        errorMessage: "El mensaje no lleva plantilla aprobada. No se envía como texto libre porque Meta lo rechazaría.",
        error: "El mensaje no lleva plantilla aprobada.",
      },
    });
    await writeAudit({ actorEmail: "automation", action: "MESSAGE_OMITTED", entityType: "OutboundMessage", entityId: message.id, metadata: { reason: "WHATSAPP_TEMPLATE_MISSING", channel: message.channel } });
    return { ok: false, errorCode: "WHATSAPP_TEMPLATE_MISSING", error: "El mensaje de WhatsApp no lleva plantilla aprobada." };
  }

  const result = await buildChannel(message.channel).send({
    to: message.channel === "WHATSAPP" ? toWhatsAppRecipient(message.toAddress) : message.toAddress,
    subject: message.subject ?? undefined,
    body: message.body,
    template: template ?? undefined,
    reference: message.id,
  });
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

/**
 * Recupera inscripciones pagadas que se quedaron sin journey.
 *
 * Activar el journey al verificar el pago puede fallar —un corte, un despliegue
 * a medias— y ese fallo no revierte el cobro, como debe ser. Sin esta segunda
 * oportunidad, la persona se quedaria pagada y sin bienvenida para siempre.
 *
 * Es deliberadamente estrecha. Solo mira cursos de pago, solo inscripciones con
 * una compra verificada, solo las que no tienen NI UN mensaje, y como mucho un
 * puñado por vuelta: no es un barrido del historico, es una red por debajo del
 * camino normal. Los cursos gratuitos ni se consultan, porque ellos nunca
 * dependieron de este disparo.
 *
 * Reutiliza `scheduleEnrollmentAutomations`, asi que hereda su idempotencia: si
 * el journey ya estaba, no crea nada nuevo.
 */
const RECONCILIACION_POR_VUELTA = 10;

/**
 * Marca de que la programacion del journey llego hasta el final.
 *
 * Existe porque "tiene mensajes" no demuestra nada: `scheduleEnrollmentAutomations`
 * hace un upsert por paso, de modo que una ejecucion que muriera despues de
 * crear la bienvenida dejaria un mensaje suelto y la inscripcion pareceria
 * atendida para siempre.
 *
 * Lo que certifica es EL SCHEDULING, no la entrega. Un fallo del proveedor
 * despues de esto no la borra ni la impide: esos mensajes tienen su propio
 * reintento y volver a programar el journey no arreglaria nada.
 *
 * Se apoya en `idempotencyKey`, que es unica en la tabla: dos procesos que
 * reconcilien la misma inscripcion a la vez producen una sola marca, y el
 * segundo recibe un choque de unicidad que aqui significa "ya estaba".
 */
export const JOURNEY_SCHEDULED = "ENROLLMENT_JOURNEY_SCHEDULED";

export async function marcarJourneyProgramado(
  enrollmentId: string,
  reason?: ScheduleSkipReason,
): Promise<boolean> {
  /**
   * Cualquier `reason` significa que el journey NO quedo programado: la
   * funcion salio antes de recorrer las reglas. Marcarlo entonces cerraria la
   * puerta para siempre a una situacion que casi siempre es temporal —un curso
   * pausado, un contacto sin consentimiento todavia, reglas sin activar— y esa
   * inscripcion no volveria a reconciliarse nunca.
   *
   * Se comprueba la existencia del motivo, no una lista de motivos concretos:
   * una lista se queda corta en cuanto alguien anade uno nuevo, que es
   * exactamente como aparecio este fallo.
   */
  if (reason) return false;
  // El contacto se resuelve aqui para que quien llama no tenga que arrastrarlo.
  // Marcar ocurre una vez por inscripcion, asi que la consulta extra no pesa.
  const inscripcion = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, select: { leadId: true } });
  if (!inscripcion) return false;
  try {
    await prisma.leadEvent.create({
      data: {
        leadId: inscripcion.leadId,
        enrollmentId,
        type: JOURNEY_SCHEDULED,
        idempotencyKey: `journey-scheduled:${enrollmentId}`,
        payload: { reason: reason ?? null },
      },
    });
    return true;
  } catch (error: unknown) {
    // P2002 es la marca que ya existia: el journey esta programado igualmente.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

export async function reconcileEntitledEnrollments(now = new Date()) {
  const pendientes = await prisma.enrollment.findMany({
    where: {
      status: { in: ["INTERESADO", "INSCRITO", "EN_CURSO"] },
      course: {
        isFree: false,
        isPublished: true,
        // Un curso pausado no programa nada, asi que revisarlo cada vuelta es
        // trabajo perdido. Al reanudarlo vuelve a entrar por si solo.
        automationsPausedAt: null,
        automationRules: { some: { status: "ACTIVE" } },
      },
      // Sin contacto elegible el programador se detiene antes de crear nada.
      lead: { classification: "REAL", consent: true },
      purchases: { some: { status: ESTADO_PAGO_VERIFICADO } },
      // Sin la marca de haber terminado. NO "sin mensajes": la programacion
      // hace un upsert por paso, asi que una que muriera a medio camino dejaria
      // mensajes creados y, mirando solo eso, pareceria hecha para siempre.
      events: { none: { type: JOURNEY_SCHEDULED } },
    },
    select: { id: true },
    take: RECONCILIACION_POR_VUELTA,
  });

  let recuperadas = 0;
  for (const inscripcion of pendientes) {
    const resultado = await scheduleEnrollmentAutomations(inscripcion.id, now).catch(() => null);
    if (!resultado) continue;
    // Se marca aunque no haya encolado nada nuevo: lo que la marca certifica es
    // que la programacion llego hasta el final, no cuantos mensajes salieron.
    // Una segunda vuelta completa lo que falto y entonces si queda marcada.
    const marcada = await marcarJourneyProgramado(inscripcion.id, resultado.reason);
    if (!marcada) continue;
    recuperadas++;
    await writeAudit({
      actorEmail: "automation",
      action: "ENROLLMENT_JOURNEY_RECONCILED",
      entityType: "Enrollment",
      entityId: inscripcion.id,
      metadata: { enqueued: resultado.enqueued, updated: resultado.updated },
    }).catch(() => undefined);
  }
  return { revisadas: pendientes.length, recuperadas };
}

const DISPATCH_CHANNELS: MessageChannel[] = ["EMAIL", "WHATSAPP"];

export async function processScheduledMessages(now = new Date()) {
  // Cada canal se evalúa por separado: un canal bloqueado ya no detiene al
  // otro. Antes compartían una única puerta, de modo que un fallo de
  // configuración de WhatsApp habría dejado el correo sin salir.
  const blockedChannels: Array<{ channel: MessageChannel; errorCode: string; error: string }> = [];
  const channelFilters: Prisma.OutboundMessageWhereInput[] = [];
  for (const channel of DISPATCH_CHANNELS) {
    const channelWindow = resolveChannelWindow(channel);
    if (channelWindow.state === "blocked") {
      blockedChannels.push({ channel, errorCode: channelWindow.errorCode, error: channelWindow.error });
      await writeAudit({
        actorEmail: "automation",
        action: "MESSAGE_DISPATCH_BLOCKED",
        entityType: "OutboundMessage",
        result: "FAILURE",
        metadata: { channel, errorCode: channelWindow.errorCode, variable: channelLiveFromVariable(channel) },
      });
      continue;
    }
    channelFilters.push(
      channelWindow.state === "live"
        ? { channel, scheduledAt: { gte: channelWindow.liveFrom } }
        : { channel },
    );
  }

  if (channelFilters.length === 0) {
    const first = blockedChannels[0];
    return { blocked: true, blockedChannels, errorCode: first?.errorCode ?? null, error: first?.error ?? null, automations: null, processed: 0, succeeded: 0, failed: 0, results: [] };
  }

  // Antes de despachar: si alguien pago y su journey no llego a crearse, se
  // crea ahora y sus mensajes vencidos salen en esta misma vuelta.
  const reconciliadas = await reconcileEntitledEnrollments(now);
  const automations = await processDueAutomationRules(now);
  const pending = await prisma.outboundMessage.findMany({
    where: {
      AND: [
        { OR: channelFilters },
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
  const finalized = await finalizeCompletedCourseEnrollments(now);
  return { blocked: false, blockedChannels, errorCode: null, error: null, automations, reconciliadas, finalized, processed: results.length, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, results };
}
