// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    outboundMessage: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    automationRule: { update: vi.fn() },
    conversation: { findUnique: vi.fn(async () => null) },
  },
  writeAudit: vi.fn(async () => undefined),
  emailSend: vi.fn(async () => ({ ok: true, providerName: "smtp", providerMessageId: "correo-1" })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("./channels/email", () => ({ EmailChannel: class { send = mocks.emailSend } }));
vi.mock("./channels/whatsapp", () => ({ WhatsAppChannel: class { send = vi.fn(); isConfigured = () => false } }));

import { sendMessage } from "./engine";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function emailLive() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("MESSAGING_MODE", "live");
  vi.stubEnv("MESSAGING_LIVE_FROM", "2026-08-01T00:00:00Z");
}

function message(overrides: Record<string, any> = {}) {
  return {
    id: "msg-1", channel: "EMAIL", toAddress: "persona@example.test", subject: "Asunto", body: "cuerpo",
    attemptCount: 0, automationRuleId: "regla-1", waTemplate: null,
    lead: { phone: null, classification: "REAL", consent: true },
    automationRule: { planKey: "welcome" },
    enrollment: {
      status: "INSCRITO",
      course: { isFree: true, isPublished: true, automationsPausedAt: null },
      purchases: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.outboundMessage.update.mockResolvedValue({});
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.conversation.findUnique.mockResolvedValue(null);
  mocks.emailSend.mockClear();
  mocks.writeAudit.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

/**
 * Sección 36 del release de estabilización: pausar un curso ("Pausar
 * automatizaciones") documenta que los mensajes pendientes "dejan de...
 * salir mientras dure la pausa", pero nada volvía a comprobar la pausa en el
 * momento del envío: un mensaje ya PROGRAMADO antes de pausar salía igual.
 */
describe("sendMessage revalida la pausa del curso justo antes de enviar", () => {
  it("curso pausado DESPUÉS de programar el mensaje: se omite en vez de enviarse", async () => {
    emailLive();
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "EMAIL" })
      .mockResolvedValueOnce(message({ enrollment: { ...message().enrollment, course: { isFree: true, automationsPausedAt: new Date("2026-08-09T00:00:00.000Z") } } }));

    const result = await sendMessage("msg-1");

    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "COURSE_AUTOMATIONS_PAUSED", nextAttemptAt: null }),
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "MESSAGE_OMITTED",
      metadata: expect.objectContaining({ reason: "COURSE_AUTOMATIONS_PAUSED" }),
    }));
  });

  it("curso sin pausa: se envía con normalidad", async () => {
    emailLive();
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "EMAIL" })
      .mockResolvedValueOnce(message());

    const result = await sendMessage("msg-1");

    expect(result).toMatchObject({ ok: true, providerMessageId: "correo-1" });
    expect(mocks.emailSend).toHaveBeenCalledTimes(1);
  });

  it("curso pausado Y sin derecho de pago: el motivo de negocio (COURSE_NOT_ENTITLED) se reporta primero", async () => {
    emailLive();
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "EMAIL" })
      .mockResolvedValueOnce(message({
        enrollment: { status: "INSCRITO", course: { isFree: false, automationsPausedAt: new Date("2026-08-09T00:00:00.000Z") }, purchases: [] },
      }));

    const result = await sendMessage("msg-1");

    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ errorCode: "COURSE_NOT_ENTITLED" }) }),
    );
  });
});
