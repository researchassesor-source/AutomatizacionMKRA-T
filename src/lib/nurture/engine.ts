import { prisma } from "@/lib/db";
import type { MessageChannel } from "@prisma/client";
import { EmailChannel } from "./channels/email";
import { WhatsAppChannel } from "./channels/whatsapp";
import type { MessageChannelAdapter } from "./channels/types";
import { welcomeSequence, type Sequence } from "./sequences";

// Registro de canales, construidos desde variables de entorno.
function buildChannels(): Record<MessageChannel, MessageChannelAdapter> {
  return {
    EMAIL: new EmailChannel({
      apiKey: process.env.EMAIL_API_KEY,
      from: process.env.EMAIL_FROM,
    }),
    WHATSAPP: new WhatsAppChannel({
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    }),
  };
}

const channels = buildChannels();

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Encola todos los pasos de una secuencia para un lead, calculando la hora de
 * envio de cada paso. Es idempotente por (lead, secuencia, paso): si ya se
 * encolo antes, no duplica.
 */
export async function enqueueSequence(
  leadId: string,
  sequence: Sequence = welcomeSequence,
) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { course: true },
  });
  if (!lead) return { enqueued: 0 };

  const appUrl = process.env.APP_URL ?? "https://ra-training.com";
  const vars = {
    nombre: lead.fullName.split(" ")[0] ?? lead.fullName,
    curso: lead.course?.title ?? "tu curso",
    appUrl,
  };
  const now = Date.now();

  let enqueued = 0;
  for (const step of sequence.steps) {
    // Salta pasos de WhatsApp si el lead no dejo telefono.
    const to = step.channel === "EMAIL" ? lead.email : lead.phone;
    if (!to) continue;

    const already = await prisma.outboundMessage.findFirst({
      where: { leadId, sequenceKey: sequence.key, stepKey: step.key },
    });
    if (already) continue;

    await prisma.outboundMessage.create({
      data: {
        leadId,
        channel: step.channel,
        toAddress: to,
        subject: step.subject ? render(step.subject, vars) : null,
        body: render(step.body, vars),
        status: "PROGRAMADO",
        scheduledAt: new Date(now + step.delayHours * 3600_000),
        sequenceKey: sequence.key,
        stepKey: step.key,
      },
    });
    enqueued++;
  }

  return { enqueued };
}

/** Envia un mensaje concreto por su canal y actualiza su estado. */
export async function sendMessage(messageId: string) {
  const msg = await prisma.outboundMessage.findUnique({ where: { id: messageId } });
  if (!msg) return { ok: false, error: "mensaje no encontrado" };

  const adapter = channels[msg.channel];
  await prisma.outboundMessage.update({
    where: { id: msg.id },
    data: { status: "ENVIANDO" },
  });

  const result = await adapter.send({
    to: msg.toAddress,
    subject: msg.subject ?? undefined,
    body: msg.body,
  });

  await prisma.outboundMessage.update({
    where: { id: msg.id },
    data: result.ok
      ? { status: "ENVIADO", sentAt: new Date(), error: null }
      : { status: "FALLIDO", error: result.error },
  });

  return result;
}

/**
 * Procesa la cola: envia los mensajes PROGRAMADO cuya hora ya llego.
 * Pensado para un cron (ver README).
 */
export async function processScheduledMessages(now = new Date()) {
  const pending = await prisma.outboundMessage.findMany({
    where: { status: "PROGRAMADO", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });

  const results = [];
  for (const msg of pending) {
    results.push({ id: msg.id, ...(await sendMessage(msg.id)) });
  }
  return { processed: results.length, results };
}
