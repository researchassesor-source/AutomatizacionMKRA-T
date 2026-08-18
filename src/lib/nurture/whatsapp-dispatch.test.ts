// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    outboundMessage: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    automationRule: { findMany: vi.fn(), update: vi.fn() },
    enrollment: { findMany: vi.fn(), findUnique: vi.fn() },
    courseSession: { findMany: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
  waSend: vi.fn(async () => ({ ok: true, providerName: "whatsapp_cloud", providerMessageId: "wamid.OK", acceptedAt: new Date() })),
  emailSend: vi.fn(async () => ({ ok: true, providerName: "smtp", providerMessageId: "correo-1" })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("./channels/email", () => ({ EmailChannel: class { send = mocks.emailSend } }));
vi.mock("./channels/whatsapp", () => ({ WhatsAppChannel: class { send = mocks.waSend; isConfigured = () => true } }));

import { processScheduledMessages, readStoredTemplate, resolveWhatsAppTemplate, sendMessage } from "./engine";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const TEMPLATE = { name: "ra_training_bienvenida_inscripcion", language: "es", components: [{ type: "body", parameters: [{ type: "text", text: "Angel" }] }] };

function waLive() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("WHATSAPP_MODE", "live");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "111");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-de-prueba");
  vi.stubEnv("WHATSAPP_LIVE_FROM", "2026-08-01T00:00:00Z");
}

function emailLive() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("MESSAGING_MODE", "live");
  vi.stubEnv("MESSAGING_LIVE_FROM", "2026-08-01T00:00:00Z");
}

function message(overrides: Record<string, any> = {}) {
  return {
    id: "msg-1", channel: "WHATSAPP", toAddress: "+593999999999", subject: null, body: "vista previa",
    attemptCount: 0, automationRuleId: "regla-1", waTemplate: TEMPLATE,
    lead: { classification: "REAL", consent: true },
    ...overrides,
  };
}

beforeEach(() => {
  // El reloj consulta las inscripciones pagadas sin journey antes de
  // despachar; sin este valor la reconciliacion recibe undefined.
  mocks.prisma.enrollment.findMany.mockResolvedValue([]);
  mocks.prisma.automationRule.findMany.mockResolvedValue([]);
  mocks.prisma.outboundMessage.findMany.mockResolvedValue([]);
  mocks.prisma.outboundMessage.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.courseSession.findMany.mockResolvedValue([]);
  // El motor encadena .catch() sobre estas escrituras: deben ser promesas.
  mocks.prisma.automationRule.update.mockResolvedValue({});
  mocks.prisma.outboundMessage.update.mockResolvedValue({});
  mocks.prisma.outboundMessage.update.mockClear();
  mocks.waSend.mockClear();
  mocks.emailSend.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("independencia entre correo y WhatsApp", () => {
  it("WhatsApp deshabilitado no impide que salga el correo", async () => {
    emailLive();
    // WHATSAPP_MODE sin definir: el canal está apagado.
    const summary = await processScheduledMessages(NOW);
    expect(summary.blocked).toBe(false);
    expect(summary.blockedChannels.map((item: any) => item.channel)).toEqual(["WHATSAPP"]);
    const where = mocks.prisma.outboundMessage.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([{ channel: "EMAIL", scheduledAt: { gte: new Date("2026-08-01T00:00:00.000Z") } }]);
  });

  it("un correo mal configurado no impide que salga WhatsApp", async () => {
    waLive();
    vi.stubEnv("MESSAGING_MODE", "live"); // sin MESSAGING_LIVE_FROM: bloqueado
    const summary = await processScheduledMessages(NOW);
    expect(summary.blocked).toBe(false);
    expect(summary.blockedChannels.map((item: any) => item.channel)).toEqual(["EMAIL"]);
    const where = mocks.prisma.outboundMessage.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([{ channel: "WHATSAPP", scheduledAt: { gte: new Date("2026-08-01T00:00:00.000Z") } }]);
  });

  it("cada canal aplica su propia fecha de corte", async () => {
    waLive();
    emailLive();
    vi.stubEnv("WHATSAPP_LIVE_FROM", "2026-08-09T00:00:00Z");
    await processScheduledMessages(NOW);
    const where = mocks.prisma.outboundMessage.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([
      { channel: "EMAIL", scheduledAt: { gte: new Date("2026-08-01T00:00:00.000Z") } },
      { channel: "WHATSAPP", scheduledAt: { gte: new Date("2026-08-09T00:00:00.000Z") } },
    ]);
  });

  it("si los dos canales están bloqueados no se consulta nada", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("MESSAGING_MODE", "live"); // sin fecha
    const summary = await processScheduledMessages(NOW);
    expect(summary.blocked).toBe(true);
    expect(mocks.prisma.outboundMessage.findMany).not.toHaveBeenCalled();
  });
});

describe("prohibición del texto libre", () => {
  it("un mensaje de WhatsApp sin plantilla se omite en lugar de enviarse", async () => {
    waLive();
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "WHATSAPP" })
      .mockResolvedValueOnce(message({ waTemplate: null }));
    const result = await sendMessage("msg-1");
    expect(mocks.waSend).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, errorCode: "WHATSAPP_TEMPLATE_MISSING" });
    expect(mocks.prisma.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "OMITIDO", errorCode: "WHATSAPP_TEMPLATE_MISSING" }) }),
    );
  });

  it("una plantilla incompleta guardada en la base tampoco sirve como plantilla", () => {
    expect(readStoredTemplate(null)).toBeNull();
    expect(readStoredTemplate({ name: "t", language: "es" })).toBeNull();
    expect(readStoredTemplate({ name: "", language: "es", components: [] })).toBeNull();
    expect(readStoredTemplate([{ name: "t" }])).toBeNull();
    expect(readStoredTemplate(TEMPLATE)).toMatchObject({ name: TEMPLATE.name });
  });

  it("envía la plantilla almacenada, no el cuerpo legible", async () => {
    waLive();
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "WHATSAPP" })
      .mockResolvedValueOnce(message());
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, providerMessageId: "wamid.OK" });
    expect(mocks.waSend).toHaveBeenCalledWith(expect.objectContaining({ template: expect.objectContaining({ name: TEMPLATE.name }) }));
  });

  it("el correo no se ve afectado por la comprobación de plantilla", async () => {
    emailLive();
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "EMAIL" })
      .mockResolvedValueOnce(message({ channel: "EMAIL", waTemplate: null, toAddress: "persona@example.test" }));
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true });
    expect(mocks.emailSend).toHaveBeenCalled();
  });

  it("una regla de WhatsApp sin plantilla no produce un mensaje de texto al programar", () => {
    const resultado = resolveWhatsAppTemplate(
      { channel: "WHATSAPP", waTemplateName: null, waTemplateLanguage: null, waTemplateBodyVars: null, waTemplateUrlVar: null },
      { nombre: "Angel" },
    );
    expect(resultado.payload).toBeNull();
    expect(resultado.problem).toMatchObject({ code: "WHATSAPP_TEMPLATE_MISSING" });
  });

  it("una variable que falta se detecta al programar, no al enviar", () => {
    const resultado = resolveWhatsAppTemplate(
      { channel: "WHATSAPP", waTemplateName: "t", waTemplateLanguage: "es", waTemplateBodyVars: ["nombre", "streamUrl"], waTemplateUrlVar: null },
      { nombre: "Angel", streamUrl: "" },
    );
    expect(resultado.payload).toBeNull();
    expect(resultado.problem?.code).toBe("TEMPLATE_VARIABLE_INVALID");
  });

  it("una regla de correo nunca genera plantilla", () => {
    const resultado = resolveWhatsAppTemplate(
      { channel: "EMAIL", waTemplateName: "sobrante", waTemplateLanguage: "es", waTemplateBodyVars: ["nombre"], waTemplateUrlVar: null },
      { nombre: "Angel" },
    );
    expect(resultado).toEqual({ payload: null, problem: null });
  });
});

describe("reintentos y concurrencia", () => {
  it("dos ejecuciones simultáneas no envían el mismo mensaje dos veces", async () => {
    waLive();
    mocks.prisma.outboundMessage.findUnique.mockResolvedValue({ scheduledAt: NOW, channel: "WHATSAPP" });
    // El segundo cron no consigue reclamar el mensaje: la condición del
    // updateMany ya no se cumple porque el primero lo pasó a ENVIANDO.
    mocks.prisma.outboundMessage.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await sendMessage("msg-1");
    expect(result.ok).toBe(false);
    expect(mocks.waSend).not.toHaveBeenCalled();
  });

  it("un fallo permanente agota los intentos en lugar de repetirse", async () => {
    waLive();
    mocks.waSend.mockResolvedValueOnce({ ok: false, errorCode: "WHATSAPP_132001", error: "plantilla inexistente", permanent: true, providerName: "whatsapp_cloud" } as any);
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "WHATSAPP" })
      .mockResolvedValueOnce(message());
    await sendMessage("msg-1");
    const data = mocks.prisma.outboundMessage.update.mock.calls.at(-1)?.[0].data;
    expect(data).toMatchObject({ status: "FALLIDO", errorCode: "WHATSAPP_132001", nextAttemptAt: null });
  });

  it("un fallo recuperable sí programa un reintento", async () => {
    waLive();
    mocks.waSend.mockResolvedValueOnce({ ok: false, errorCode: "WHATSAPP_4", error: "límite", permanent: false, providerName: "whatsapp_cloud" } as any);
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "WHATSAPP" })
      .mockResolvedValueOnce(message());
    await sendMessage("msg-1");
    const data = mocks.prisma.outboundMessage.update.mock.calls.at(-1)?.[0].data;
    expect(data.status).toBe("FALLIDO");
    expect(data.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("en simulación no se llama a Meta y el mensaje queda como SIMULADO", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WHATSAPP_MODE", "simulation");
    mocks.prisma.outboundMessage.findUnique
      .mockResolvedValueOnce({ scheduledAt: NOW, channel: "WHATSAPP" })
      .mockResolvedValueOnce(message());
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: true, simulated: true });
    expect(mocks.waSend).not.toHaveBeenCalled();
  });

  it("con el canal deshabilitado no se reclama ni se modifica el mensaje", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    mocks.prisma.outboundMessage.findUnique.mockResolvedValueOnce({ scheduledAt: NOW, channel: "WHATSAPP" });
    const result = await sendMessage("msg-1");
    expect(result).toMatchObject({ ok: false, errorCode: "WHATSAPP_DISABLED" });
    expect(mocks.prisma.outboundMessage.updateMany).not.toHaveBeenCalled();
  });
});
