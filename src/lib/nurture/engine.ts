import { Prisma, type MessageChannel } from "@prisma/client";
import { automationRuleCanRun, courseAcceptsAutomations } from "@/lib/automation-eligibility";
import { calculateAutomationSchedule, supportsEnrollmentStatus } from "@/lib/automation-schedule";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { mustSimulateExternalIntegration } from "@/lib/runtime-environment";
import { EmailChannel } from "./channels/email";
import { WhatsAppChannel } from "./channels/whatsapp";
import type { MessageChannelAdapter, SendResult } from "./channels/types";
import { welcomeSequence, type Sequence } from "./sequences";

const MAX_ATTEMPTS = 5;
const DISPATCH_BATCH_SIZE = 50;
const DISPATCH_CONCURRENCY = 10;

function buildChannels(): Record<MessageChannel, MessageChannelAdapter> {
  return {
    EMAIL: new EmailChannel({ apiKey: process.env.EMAIL_API_KEY, from: process.env.EMAIL_FROM }),
    WHATSAPP: new WhatsAppChannel({
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    }),
  };
}

const channels = buildChannels();

export function isMessagingSimulation(): boolean {
  return mustSimulateExternalIntegration(process.env.MESSAGING_MODE);
}

export function isAutomationEligibleContact(classification: string, consent: boolean) {
  return classification === "REAL" && consent;
}

export const TEMPLATE_VARIABLES = [
  "nombre", "apellido", "curso", "courseUrl", "moodleUrl", "asesor", "fecha",
  "hora", "modalidad", "enlace", "appUrl",
] as const;

export function renderMessageTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    TEMPLATE_VARIABLES.includes(key as (typeof TEMPLATE_VARIABLES)[number]) ? vars[key] ?? "" : match,
  );
}

function templateVariables(lead: { firstName: string | null; lastName: string | null; fullName: string; assignedToId: string | null }, course: { title: string; officialCourseUrl: string; moodleCourseUrl: string | null; startsAt: Date | null; modality: string | null }) {
  const startsAt = course.startsAt;
  return {
    nombre: lead.firstName ?? lead.fullName.split(" ")[0] ?? lead.fullName,
    apellido: lead.lastName ?? "",
    curso: course.title,
    courseUrl: course.officialCourseUrl,
    moodleUrl: course.moodleCourseUrl ?? "",
    asesor: lead.assignedToId ? "tu asesor de R.A. Training" : "R.A. Training",
    fecha: startsAt ? new Intl.DateTimeFormat("es-EC", { dateStyle: "long", timeZone: "America/Guayaquil" }).format(startsAt) : "por confirmar",
    hora: startsAt ? new Intl.DateTimeFormat("es-EC", { timeStyle: "short", timeZone: "America/Guayaquil" }).format(startsAt) : "por confirmar",
    modalidad: course.modality ?? "por confirmar",
    enlace: course.moodleCourseUrl ?? course.officialCourseUrl,
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

export async function scheduleEnrollmentAutomations(
  enrollmentId: string,
  now = new Date(),
  options: { ruleIds?: string[]; allowPastDueMinutes?: number } = {},
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { lead: true, course: { include: { automationRules: { where: { status: "ACTIVE", ...(options.ruleIds?.length ? { id: { in: options.ruleIds } } : {}) } } } } },
  });
  if (!enrollment) return { enqueued: 0, reason: "ENROLLMENT_NOT_FOUND" };
  if (!isAutomationEligibleContact(enrollment.lead.classification, enrollment.lead.consent)) {
    return { enqueued: 0, reason: "CONTACT_EXCLUDED" };
  }
  if (!courseAcceptsAutomations(enrollment.course)) {
    return { enqueued: 0, reason: "COURSE_NOT_ELIGIBLE" };
  }
  const vars = templateVariables(enrollment.lead, enrollment.course);
  let enqueued = 0;
  let skipped = 0;
  for (const rule of enrollment.course.automationRules) {
    if (!automationRuleCanRun(enrollment.course, rule)) { skipped++; continue; }
    if (rule.campaignId && rule.campaignId !== enrollment.campaignId) { skipped++; continue; }
    if (!supportsEnrollmentStatus(rule.enrollmentStatuses, enrollment.status)) { skipped++; continue; }
    const scheduledAt = calculateAutomationSchedule({
      trigger: rule.trigger,
      offsetMinutes: rule.offsetMinutes,
      registeredAt: enrollment.createdAt,
      startsAt: enrollment.course.startsAt,
      endsAt: enrollment.course.endsAt,
    });
    const oldestAllowed = new Date(now.getTime() - (options.allowPastDueMinutes ?? 0) * 60_000);
    if (!scheduledAt || (rule.trigger !== "ON_REGISTRATION" && scheduledAt < oldestAllowed)) { skipped++; continue; }
    const toAddress = rule.channel === "EMAIL" ? enrollment.lead.email : enrollment.lead.phone;
    if (!toAddress) { skipped++; continue; }
    try {
      await prisma.outboundMessage.create({
        data: {
          leadId: enrollment.leadId,
          enrollmentId: enrollment.id,
          automationRuleId: rule.id,
          channel: rule.channel,
          toAddress,
          subject: rule.subject ? renderMessageTemplate(rule.subject, vars) : null,
          body: renderMessageTemplate(rule.body, vars),
          status: "PROGRAMADO",
          scheduledAt,
          sequenceKey: `automation:${rule.id}`,
          stepKey: `enrollment:${enrollment.id}`,
          isSimulation: isMessagingSimulation(),
        },
      });
      enqueued++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") skipped++;
      else throw error;
    }
  }
  if (enqueued > 0) {
    await writeAudit({
      actorEmail: "automation",
      action: "AUTOMATION_MESSAGES_QUEUED",
      entityType: "Enrollment",
      entityId: enrollment.id,
      metadata: { enqueued, skipped, courseId: enrollment.courseId, simulation: isMessagingSimulation() },
    });
  }
  return { enqueued, skipped };
}

export async function processDueAutomationRules(now = new Date()) {
  const rules = await prisma.automationRule.findMany({
    where: {
      status: "ACTIVE",
      trigger: { in: ["BEFORE_COURSE", "AFTER_COURSE"] },
      nextExecutionAt: { lte: now, gte: new Date(now.getTime() - 24 * 60 * 60_000) },
      course: { isPublished: true, acceptsRegistrations: true },
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

  const result = await channels[message.channel].send({ to: message.toAddress, subject: message.subject ?? undefined, body: message.body });
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

export async function processScheduledMessages(now = new Date()) {
  const automations = await processDueAutomationRules(now);
  const pending = await prisma.outboundMessage.findMany({
    where: {
      OR: [
        { status: "PROGRAMADO", scheduledAt: { lte: now } },
        { status: "FALLIDO", attemptCount: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
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
  return { automations, processed: results.length, succeeded: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, results };
}
