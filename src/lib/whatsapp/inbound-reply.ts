import { WhatsAppChannel } from "@/lib/nurture/channels/whatsapp";
import type { SendInput, SendResult } from "@/lib/nurture/channels/types";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  resolveWhatsAppConfig,
  resolveWhatsAppWindow,
  toWhatsAppRecipient,
  type EnvSource,
} from "@/lib/whatsapp/config";
import type { InboundNotice } from "@/lib/whatsapp/webhook";

export const WHATSAPP_HUMAN_SUPPORT_NUMBER = "WHATSAPP_HUMAN_SUPPORT_NUMBER";
export const INBOUND_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type HumanSupport = {
  supportNumber: string;
  supportUrl: string;
};

type RateLimit = typeof checkRateLimit;
type Send = (input: SendInput) => Promise<SendResult>;

export type InboundReplyOutcome =
  | { status: "sent" }
  | { status: "rate_limited" }
  | { status: "self_message" }
  | { status: "not_live" }
  | { status: "invalid_sender" }
  | { status: "support_not_configured" }
  | { status: "send_failed"; errorCode: string };

function normalizedPhone(raw: string | undefined): string | null {
  const digits = raw ? toWhatsAppRecipient(raw) : "";
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Configuración interna. El número nunca forma parte del estado público del canal. */
export function resolveHumanSupport(env: EnvSource = process.env): HumanSupport | null {
  const supportNumber = normalizedPhone(env[WHATSAPP_HUMAN_SUPPORT_NUMBER]);
  if (!supportNumber) return null;
  return {
    supportNumber,
    supportUrl: `https://wa.me/${supportNumber}`,
  };
}

export function buildInboundSupportReply(support: HumanSupport): string {
  return `👋 ¡Hola! Gracias por escribir a R.A. Training.

Este número se utiliza exclusivamente para enviarte confirmaciones, recordatorios y enlaces de acceso a tus cursos. 📚

Si tienes alguna pregunta o necesitas atención personalizada, nuestro equipo estará encantado de ayudarte. 😊

👤 Habla con un asesor por WhatsApp:
${support.supportUrl}

📱 ${support.supportNumber}

¡Gracias por ser parte de R.A. Training! 💙`;
}

async function sendWithConfiguredChannel(env: EnvSource, input: SendInput): Promise<SendResult> {
  return new WhatsAppChannel(resolveWhatsAppConfig(env)).send(input);
}

/**
 * Responde únicamente dentro de una conversación iniciada por el usuario.
 *
 * El mismo interruptor que protege el envío programado protege este camino:
 * fuera de Producción o sin `WHATSAPP_MODE=live` no se llama a Meta. El límite
 * distribuido existente hace atómico el máximo de una respuesta cada 24 horas.
 */
export async function handleInboundSupportReply(
  notice: InboundNotice,
  dependencies: {
    env?: EnvSource;
    rateLimit?: RateLimit;
    send?: Send;
  } = {},
): Promise<InboundReplyOutcome> {
  const env = dependencies.env ?? process.env;
  if (resolveWhatsAppWindow(env).state !== "live") return { status: "not_live" };

  const sender = normalizedPhone(notice.sender);
  if (!sender) return { status: "invalid_sender" };

  const businessNumbers = [
    normalizedPhone(notice.businessPhone),
    normalizedPhone(env.META_WHATSAPP_DISPLAY_NUMBER),
  ].filter((number): number is string => Boolean(number));
  if (businessNumbers.includes(sender)) return { status: "self_message" };

  const support = resolveHumanSupport(env);
  if (!support) return { status: "support_not_configured" };

  const limit = await (dependencies.rateLimit ?? checkRateLimit)(
    `whatsapp-inbound-support:${sender}`,
    { limit: 1, windowMs: INBOUND_REPLY_WINDOW_MS },
  );
  if (!limit.allowed) return { status: "rate_limited" };

  try {
    const result = await (dependencies.send ?? ((input) => sendWithConfiguredChannel(env, input)))({
      to: sender,
      body: buildInboundSupportReply(support),
      reference: `inbound-support:${notice.providerMessageId}`,
    });
    if (result.ok) return { status: "sent" };
    return { status: "send_failed", errorCode: result.errorCode ?? "WHATSAPP_SEND_FAILED" };
  } catch {
    return { status: "send_failed", errorCode: "WHATSAPP_SEND_EXCEPTION" };
  }
}
