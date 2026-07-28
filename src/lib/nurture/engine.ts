import { prisma } from "@/lib/db";
import { Prisma, type MessageChannel } from "@prisma/client";
import { EmailChannel } from "./channels/email";
import { WhatsAppChannel } from "./channels/whatsapp";
import type { MessageChannelAdapter } from "./channels/types";
import { welcomeSequence, type Sequence } from "./sequences";

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
  return process.env.NODE_ENV !== "production" || process.env.MESSAGING_MODE !== "live";
}

export const TEMPLATE_VARIABLES = [
  "nombre",
  "apellido",
  "curso",
  "courseUrl",
  "moodleUrl",
  "asesor",
  "fecha",
  "appUrl",
] as const;

export function renderMessageTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    TEMPLATE_VARIABLES.includes(key as (typeof TEMPLATE_VARIABLES)[number]) ? vars[key] ?? "" : match,
  );
}

export async function enqueueSequence(
  leadId: string,
  enrollmentId?: string,
  sequence: Sequence = welcomeSequence,
) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { enqueued: 0 };

  const enrollment = enrollmentId
    ? await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { course: true } })
    : await prisma.enrollment.findFirst({
        where: { leadId },
        orderBy: { createdAt: "desc" },
        include: { course: true },
      });
  if (!enrollment) return { enqueued: 0 };

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const vars = {
    nombre: lead.firstName ?? lead.fullName.split(" ")[0] ?? lead.fullName,
    apellido: lead.lastName ?? "",
    curso: enrollment.course.title,
    courseUrl: enrollment.course.officialCourseUrl,
    moodleUrl: enrollment.course.moodleCourseUrl ?? "",
    asesor: lead.assignedToId ? "tu asesor de R.A. Training" : "R.A. Training",
    fecha: new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil" }).format(new Date()),
    appUrl,
  };
  const now = Date.now();

  let enqueued = 0;
  for (const step of sequence.steps) {
    const to = step.channel === "EMAIL" ? lead.email : lead.phone;
    if (!to) continue;
    const already = await prisma.outboundMessage.findFirst({
      where: {
        leadId,
        enrollmentId: enrollment.id,
        sequenceKey: sequence.key,
        stepKey: step.key,
        status: { not: "CANCELADO" },
      },
    });
    if (already) continue;

    try {
      await prisma.outboundMessage.create({
        data: {
          leadId,
          enrollmentId: enrollment.id,
          channel: step.channel,
          toAddress: to,
          subject: step.subject ? renderMessageTemplate(step.subject, vars) : null,
          body: renderMessageTemplate(step.body, vars),
          status: "PROGRAMADO",
          scheduledAt: new Date(now + step.delayHours * 3600_000),
          sequenceKey: sequence.key,
          stepKey: step.key,
        },
      });
      enqueued++;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  return { enqueued };
}

export async function sendMessage(messageId: string) {
  const claimed = await prisma.outboundMessage.updateMany({
    where: { id: messageId, status: { in: ["PROGRAMADO", "FALLIDO"] } },
    data: { status: "ENVIANDO", attempts: { increment: 1 }, error: null },
  });
  if (claimed.count !== 1) return { ok: false, error: "El mensaje ya fue procesado." };

  const message = await prisma.outboundMessage.findUnique({ where: { id: messageId } });
  if (!message) return { ok: false, error: "Mensaje no encontrado." };

  if (isMessagingSimulation()) {
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: { status: "SIMULADO", isSimulation: true, error: null },
    });
    return { ok: true, simulated: true };
  }

  const adapter = channels[message.channel];
  const result = await adapter.send({
    to: message.toAddress,
    subject: message.subject ?? undefined,
    body: message.body,
  });

  await prisma.outboundMessage.update({
    where: { id: message.id },
    data: result.ok
      ? result.simulated
        ? { status: "SIMULADO", isSimulation: true, error: null }
        : { status: "ENVIADO", sentAt: new Date(), isSimulation: false, error: null }
      : { status: "FALLIDO", error: result.error?.slice(0, 500) ?? "No se pudo enviar." },
  });
  return result;
}

export async function processScheduledMessages(now = new Date()) {
  const pending = await prisma.outboundMessage.findMany({
    where: { status: "PROGRAMADO", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 50,
    select: { id: true },
  });
  const results = [];
  for (const message of pending) results.push({ id: message.id, ...(await sendMessage(message.id)) });
  return { processed: results.length, results };
}
