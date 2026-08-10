import { describe, expect, it, vi } from "vitest";
import {
  buildInboundSupportReply,
  handleInboundSupportReply,
  INBOUND_REPLY_WINDOW_MS,
  resolveHumanSupport,
} from "./inbound-reply";
import type { EnvSource } from "./config";

const LIVE_ENV: EnvSource = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  WHATSAPP_MODE: "live",
  WHATSAPP_LIVE_FROM: "2026-08-09T00:00:00Z",
  WHATSAPP_PHONE_NUMBER_ID: "phone-id-de-prueba",
  WHATSAPP_ACCESS_TOKEN: "token-de-prueba-no-real",
  META_APP_SECRET: "app-secret-de-prueba-no-real",
  META_WHATSAPP_DISPLAY_NUMBER: "+593 99 111 2222",
  WHATSAPP_HUMAN_SUPPORT_NUMBER: "+1 555 123 4567",
};

const NOTICE = {
  providerMessageId: "wamid.INBOUND",
  type: "text",
  sender: "593991234567",
  businessPhone: "+593 99 111 2222",
};

describe("configuración de atención humana", () => {
  it("normaliza el número configurable y genera la URL wa.me", () => {
    expect(resolveHumanSupport({ WHATSAPP_HUMAN_SUPPORT_NUMBER: "+1 555 123 4567" })).toEqual({
      supportNumber: "15551234567",
      supportUrl: "https://wa.me/15551234567",
    });
  });

  it("rechaza una configuración ausente o que no es un teléfono internacional válido", () => {
    expect(resolveHumanSupport({})).toBeNull();
    expect(resolveHumanSupport({ WHATSAPP_HUMAN_SUPPORT_NUMBER: "abc" })).toBeNull();
  });

  it("construye literalmente la respuesta de servicio", () => {
    const support = resolveHumanSupport({ WHATSAPP_HUMAN_SUPPORT_NUMBER: "15551234567" });
    if (!support) throw new Error("La configuración de prueba debía ser válida.");
    expect(buildInboundSupportReply(support)).toBe(
      "👋 ¡Hola! Gracias por escribir a R.A. Training.\n\nEste número se utiliza exclusivamente para enviarte confirmaciones, recordatorios y enlaces de acceso a tus cursos. 📚\n\nSi tienes alguna pregunta o necesitas atención personalizada, nuestro equipo estará encantado de ayudarte. 😊\n\n👤 Habla con un asesor por WhatsApp:\nhttps://wa.me/15551234567\n\n📱 15551234567\n\n¡Gracias por ser parte de R.A. Training! 💙",
    );
  });
});

describe("respuesta a mensajes entrantes", () => {
  it("envía texto de servicio, no una sexta plantilla", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, providerMessageId: "wamid.OUTBOUND" });
    const rateLimit = vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0, distributed: true });

    await expect(handleInboundSupportReply(NOTICE, { env: LIVE_ENV, send, rateLimit }))
      .resolves.toEqual({ status: "sent" });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: NOTICE.sender,
      reference: `inbound-support:${NOTICE.providerMessageId}`,
    }));
    expect(send.mock.calls[0][0]).not.toHaveProperty("template");
    expect(send.mock.calls[0][0].body).toContain("https://wa.me/15551234567");
  });

  it("permite como máximo una respuesta cada 24 horas por usuario", async () => {
    let attempts = 0;
    const send = vi.fn().mockResolvedValue({ ok: true });
    const rateLimit = vi.fn().mockImplementation(async (_key, options) => {
      attempts++;
      expect(options).toEqual({ limit: 1, windowMs: INBOUND_REPLY_WINDOW_MS });
      return { allowed: attempts === 1, retryAfterSeconds: attempts === 1 ? 0 : 86_400, distributed: true };
    });

    await expect(handleInboundSupportReply(NOTICE, { env: LIVE_ENV, send, rateLimit }))
      .resolves.toEqual({ status: "sent" });
    await expect(handleInboundSupportReply({ ...NOTICE, providerMessageId: "wamid.RETRY" }, { env: LIVE_ENV, send, rateLimit }))
      .resolves.toEqual({ status: "rate_limited" });
    expect(send).toHaveBeenCalledOnce();
    expect(rateLimit.mock.calls[0][0]).toBe(`whatsapp-inbound-support:${NOTICE.sender}`);
  });

  it("jamás responde al propio número automático", async () => {
    const send = vi.fn();
    const rateLimit = vi.fn();

    await expect(handleInboundSupportReply({ ...NOTICE, sender: "593991112222" }, {
      env: LIVE_ENV,
      send,
      rateLimit,
    })).resolves.toEqual({ status: "self_message" });

    await expect(handleInboundSupportReply({ ...NOTICE, sender: "593991112222", businessPhone: undefined }, {
      env: LIVE_ENV,
      send,
      rateLimit,
    })).resolves.toEqual({ status: "self_message" });

    expect(rateLimit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("no llama a Meta mientras WhatsApp no esté en live", async () => {
    const send = vi.fn();
    const rateLimit = vi.fn();
    await expect(handleInboundSupportReply(NOTICE, {
      env: { ...LIVE_ENV, WHATSAPP_MODE: "simulation" },
      send,
      rateLimit,
    })).resolves.toEqual({ status: "not_live" });
    expect(rateLimit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("no renderiza tokens ni secretos en el resultado o el mensaje", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const outcome = await handleInboundSupportReply(NOTICE, {
      env: LIVE_ENV,
      send,
      rateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0, distributed: true }),
    });
    const rendered = JSON.stringify({ outcome, outbound: send.mock.calls[0][0] });
    expect(rendered).not.toContain(LIVE_ENV.WHATSAPP_ACCESS_TOKEN);
    expect(rendered).not.toContain(LIVE_ENV.META_APP_SECRET);
    expect(rendered).not.toContain(LIVE_ENV.WHATSAPP_PHONE_NUMBER_ID);
  });
});
