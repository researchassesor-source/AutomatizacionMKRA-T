// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    outboundMessage: { findUnique: vi.fn(), updateMany: vi.fn(async (_args: any) => ({ count: 0 })), update: vi.fn() },
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
    lead: { phone: null, classification: "REAL", consent: true, isArchived: false },
    automationRule: { planKey: "welcome", status: "ACTIVE" },
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

function stub(msg: ReturnType<typeof message>) {
  mocks.prisma.outboundMessage.findUnique
    .mockResolvedValueOnce({ scheduledAt: NOW, channel: "EMAIL" })
    .mockResolvedValueOnce(msg);
}

/**
 * Sección G del release de estabilización: revalidación de último momento en
 * sendMessage, justo antes de llamar al proveedor. Cada una de estas es la
 * SEGUNDA defensa -- la primera es la cuarentena que ya pone en marcha el
 * endpoint correspondiente en el mismo instante del cambio (pausar/archivar
 * regla, despublicar/pausar curso, archivar contacto).
 */
describe("sendMessage: curso despublicado después de programar", () => {
  it("se omite con COURSE_UNPUBLISHED en vez de enviarse", async () => {
    emailLive();
    stub(message({ enrollment: { ...message().enrollment, course: { isFree: true, isPublished: false, automationsPausedAt: null } } }));
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "COURSE_UNPUBLISHED", nextAttemptAt: null }),
    });
  });

  it("un curso publicado se envía con normalidad", async () => {
    emailLive();
    stub(message());
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, providerMessageId: "correo-1" });
  });
});

describe("sendMessage: la regla dejó de estar ACTIVE después de programar", () => {
  it("PAUSED se omite con RULE_PAUSED (recuperable), no se cancela", async () => {
    emailLive();
    stub(message({ automationRule: { planKey: "welcome", status: "PAUSED" } }));
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "RULE_PAUSED", nextAttemptAt: null }),
    });
  });

  it("ARCHIVED se CANCELA (irreversible), con el mismo código que usa el PATCH de la regla", async () => {
    emailLive();
    stub(message({ automationRule: { planKey: "welcome", status: "ARCHIVED" } }));
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: expect.objectContaining({ status: "CANCELADO", errorCode: "AUTOMATION_DISABLED" }),
    });
  });

  it("una regla ACTIVE se envía con normalidad", async () => {
    emailLive();
    stub(message());
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, providerMessageId: "correo-1" });
  });

  it("sin automationRuleId (mensaje sin regla asociada) no intenta este chequeo", async () => {
    emailLive();
    stub(message({ automationRuleId: null, automationRule: null }));
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, providerMessageId: "correo-1" });
  });
});

describe("sendMessage: el contacto se archivó después de programar", () => {
  it("se omite con CONTACT_ARCHIVED en vez de enviarse", async () => {
    emailLive();
    stub(message({ lead: { ...message().lead, isArchived: true } }));
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, skipped: true });
    expect(mocks.emailSend).not.toHaveBeenCalled();
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: expect.objectContaining({ status: "OMITIDO", errorCode: "CONTACT_ARCHIVED", nextAttemptAt: null }),
    });
  });

  it("un contacto no archivado se envía con normalidad", async () => {
    emailLive();
    stub(message());
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, providerMessageId: "correo-1" });
  });
});
