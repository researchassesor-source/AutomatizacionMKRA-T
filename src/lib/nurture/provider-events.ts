import { Prisma, type MessageStatus } from "@prisma/client";
import { sanitizeAuditMetadata, writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export type ProviderDeliveryState = "ACCEPTED" | "SENT" | "DELIVERED" | "READ" | "BOUNCED" | "FAILED";

const mappedStatus: Record<ProviderDeliveryState, MessageStatus> = {
  ACCEPTED: "ACEPTADO",
  SENT: "ENVIADO",
  DELIVERED: "ENTREGADO",
  READ: "LEIDO",
  BOUNCED: "REBOTADO",
  FAILED: "FALLIDO",
};

/**
 * Escalera de progreso. Solo se sube, nunca se baja: los webhooks de Meta
 * llegan sin orden garantizado y se reintentan, asi que un `sent` tardio no
 * puede deshacer un `delivered` que ya constaba.
 */
const progress: Partial<Record<MessageStatus, number>> = {
  PROGRAMADO: 0,
  ENVIANDO: 1,
  ACEPTADO: 2,
  ENVIADO: 3,
  ENTREGADO: 4,
  LEIDO: 5,
};

/** Estados de los que ya no se sale por un evento del proveedor. */
const TERMINAL: MessageStatus[] = ["SIMULADO", "CANCELADO", "OMITIDO", "REBOTADO", "LEIDO"];

export function nextMessageStatus(current: MessageStatus, event: ProviderDeliveryState): MessageStatus | null {
  const next = mappedStatus[event];
  if (TERMINAL.includes(current)) return null;
  // Un fallo se corrige solo con constancia de entrega o de lectura. Un `sent`
  // posterior a un `failed` no demuestra nada.
  if (current === "FALLIDO") return next === "ENTREGADO" || next === "LEIDO" ? next : null;
  const currentProgress = progress[current] ?? -1;
  const nextProgress = progress[next];
  if (nextProgress === undefined) {
    // FALLIDO y REBOTADO no estan en la escalera. Solo tienen sentido mientras
    // no haya constancia de entrega: un `failed` tardio no borra un
    // `delivered` que el destinatario ya recibio.
    return currentProgress >= (progress.ENTREGADO ?? 4) ? null : next;
  }
  return nextProgress > currentProgress ? next : null;
}

export async function applyMessageProviderEvent(input: {
  provider: string;
  providerMessageId: string;
  providerEventId?: string;
  state: ProviderDeliveryState;
  occurredAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}) {
  const message = await prisma.outboundMessage.findFirst({
    where: { providerName: input.provider, providerMessageId: input.providerMessageId },
  });
  if (!message) return { found: false, changed: false };
  const status = nextMessageStatus(message.status, input.state);
  const occurredAt = input.occurredAt ?? new Date();
  const providerPayload = sanitizeAuditMetadata(input.metadata) as Prisma.InputJsonValue | undefined;
  try {
    await prisma.messageProviderEvent.create({
      data: {
        messageId: message.id,
        provider: input.provider,
        providerEventId: input.providerEventId,
        type: input.state,
        payload: providerPayload,
        occurredAt,
      },
    });
  } catch (error) {
    if (input.providerEventId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { found: true, changed: false, duplicate: true };
    }
    throw error;
  }
  if (!status) return { found: true, changed: false };
  await prisma.outboundMessage.update({
    where: { id: message.id },
    data: {
      status,
      ...(status === "ACEPTADO" ? { acceptedAt: occurredAt } : {}),
      ...(status === "ENVIADO" ? { sentAt: occurredAt } : {}),
      ...(status === "ENTREGADO" ? { deliveredAt: occurredAt } : {}),
      // Leído implica entregado: si el webhook de entrega se perdió, la marca
      // de entrega se completa aquí en lugar de quedar en blanco para siempre.
      ...(status === "LEIDO" ? { readAt: occurredAt, deliveredAt: message.deliveredAt ?? occurredAt } : {}),
      ...(status === "REBOTADO" ? { bouncedAt: occurredAt } : {}),
      ...(status === "FALLIDO" ? { failedAt: occurredAt } : {}),
      errorCode: input.errorCode?.slice(0, 120),
      errorMessage: input.errorMessage?.slice(0, 500),
      error: input.errorMessage?.slice(0, 500),
      nextAttemptAt: ["ENTREGADO", "REBOTADO"].includes(status) ? null : undefined,
    },
  });
  await writeAudit({ actorEmail: "provider-webhook", action: "MESSAGE_PROVIDER_STATUS_UPDATED", entityType: "OutboundMessage", entityId: message.id, metadata: { provider: input.provider, from: message.status, to: status, providerEventId: input.providerEventId } });
  return { found: true, changed: true, status };
}
