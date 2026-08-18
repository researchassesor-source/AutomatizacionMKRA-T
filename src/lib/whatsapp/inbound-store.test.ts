// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    lead: { findMany: vi.fn() },
    enrollment: { findMany: vi.fn() },
    inboundMessage: { create: vi.fn() },
    conversation: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { guardarMensajeEntrante, normalizarRemitente } from "./inbound-store";
import { parseWebhookPayload } from "./webhook";

/**
 * Persistencia de lo que entra por WhatsApp.
 *
 * El webhook lo reintenta Meta ante cualquier respuesta que no sea 200, asi que
 * todo esto tiene que poder repetirse sin consecuencias. Y hay una asimetria
 * que manda: vincular la conversacion al contacto equivocado mezcla el
 * historial de dos personas, mientras que dejarla sin vincular solo pide una
 * revision. Por eso en duda no se elige.
 */
const OCURRIO = new Date("2026-08-20T15:00:00.000Z");

function aviso(extra: Record<string, unknown> = {}) {
  return {
    providerMessageId: "wamid.IN1",
    type: "text",
    sender: "593999999999",
    text: "hola",
    occurredAt: OCURRIO,
    ...extra,
  } as any;
}

function errorUnico() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["providerMessageId"] },
  });
}

beforeEach(() => {
  mocks.prisma.lead.findMany.mockResolvedValue([]);
  mocks.prisma.enrollment.findMany.mockResolvedValue([]);
  mocks.prisma.inboundMessage.create.mockResolvedValue({ id: "in-1" });
  mocks.prisma.conversation.findUnique.mockResolvedValue(null);
  mocks.prisma.conversation.upsert.mockResolvedValue({});
});

describe("normalización del remitente", () => {
  it("Meta entrega el número sin el más, y se convierte al formato del CRM", () => {
    expect(normalizarRemitente("593999999999")).toBe("+593999999999");
    expect(normalizarRemitente("+593999999999")).toBe("+593999999999");
  });

  it("un número que no se puede normalizar no se inventa", () => {
    expect(normalizarRemitente("12345")).toBeNull();
    expect(normalizarRemitente("no-es-un-numero")).toBeNull();
  });

  it("un remitente irreconocible no se persiste", async () => {
    const r = await guardarMensajeEntrante(aviso({ sender: "12345" }));
    expect(r).toEqual({ estado: "invalido", motivo: "TELEFONO_NO_NORMALIZABLE" });
    expect(mocks.prisma.inboundMessage.create).not.toHaveBeenCalled();
  });
});

describe("resolución del contacto", () => {
  it("con UN contacto que coincide, se vincula", async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1", assignedToId: null }]);
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toMatchObject({ estado: "guardado", leadId: "lead-1" });
  });

  it("sin ningún contacto NO se crea uno: recibir un mensaje no da de alta a nadie", async () => {
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toMatchObject({ estado: "guardado", leadId: null });
    // La conversación existe igualmente, sin vincular, para que se revise.
    expect(mocks.prisma.conversation.upsert).toHaveBeenCalled();
  });

  it("con VARIOS contactos no se adivina", async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1" }, { id: "lead-2" }]);
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toMatchObject({ leadId: null });
  });

  it("nunca toca clasificación ni consentimiento", async () => {
    // Escribir un WhatsApp no es consentir automatizaciones de marketing.
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1", assignedToId: null }]);
    await guardarMensajeEntrante(aviso());
    const escrituras = JSON.stringify(mocks.prisma.conversation.upsert.mock.calls);
    expect(escrituras).not.toContain("consent");
    expect(escrituras).not.toContain("classification");
  });

  it("con UNA inscripción viva la atribuye; con varias, ninguna", async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1", assignedToId: null }]);
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ id: "enr-1" }]);
    await guardarMensajeEntrante(aviso());
    expect(mocks.prisma.inboundMessage.create.mock.calls[0][0].data.enrollmentId).toBe("enr-1");

    mocks.prisma.inboundMessage.create.mockClear();
    mocks.prisma.enrollment.findMany.mockResolvedValue([{ id: "enr-1" }, { id: "enr-2" }]);
    await guardarMensajeEntrante(aviso({ providerMessageId: "wamid.IN2" }));
    expect(mocks.prisma.inboundMessage.create.mock.calls[0][0].data.enrollmentId).toBeNull();
  });
});

describe("idempotencia", () => {
  it("el mismo wamid repetido no duplica", async () => {
    mocks.prisma.inboundMessage.create.mockRejectedValueOnce(errorUnico());
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toEqual({ estado: "duplicado" });
    // Y no se vuelve a tocar la conversación por un reenvío.
    expect(mocks.prisma.conversation.upsert).not.toHaveBeenCalled();
  });

  it("cinco reenvíos del mismo webhook dejan un solo mensaje", async () => {
    mocks.prisma.inboundMessage.create.mockResolvedValueOnce({ id: "in-1" });
    mocks.prisma.inboundMessage.create.mockRejectedValue(errorUnico());
    const resultados = [];
    for (let i = 0; i < 5; i++) resultados.push(await guardarMensajeEntrante(aviso()));
    expect(resultados.filter((r) => r.estado === "guardado")).toHaveLength(1);
    expect(resultados.filter((r) => r.estado === "duplicado")).toHaveLength(4);
  });

  it("un fallo de base pide REINTENTO en vez de perder el mensaje", async () => {
    // Devolver "invalido" aqui haria que el webhook respondiera 200 y Meta
    // diera el lote por entregado: el mensaje se perderia sin dejar rastro.
    mocks.prisma.inboundMessage.create.mockRejectedValueOnce(new Error("base caída"));
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toEqual({ estado: "reintentable", codigo: "PERSISTENCIA_FALLIDA" });
  });

  it("si falla la conversación, el mensaje ya guardado también pide reintento", async () => {
    // Al repetirse, el mensaje será duplicado seguro y solo se rehará el upsert.
    mocks.prisma.conversation.upsert.mockRejectedValueOnce(new Error("timeout"));
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toEqual({ estado: "reintentable", codigo: "CONVERSACION_NO_PERSISTIDA" });
  });

  it("un teléfono inválido NO pide reintento: repetirlo daría lo mismo", async () => {
    const r = await guardarMensajeEntrante(aviso({ sender: "12345" }));
    expect(r.estado).toBe("invalido");
  });
});

describe("ventana y handoff", () => {
  it("un entrante abre la atención humana", async () => {
    const r = await guardarMensajeEntrante(aviso());
    expect(r).toMatchObject({ handoffAbierto: true });
    expect(mocks.prisma.conversation.upsert.mock.calls[0][0].update.state).toBe("HUMAN_HANDOFF");
  });

  it("un segundo mensaje no reabre el handoff ni mueve su fecha", async () => {
    // Reabrirlo en cada mensaje falsearía cuándo empezó la conversación.
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "HUMAN_HANDOFF", lastInboundAt: OCURRIO });
    const r = await guardarMensajeEntrante(aviso({ providerMessageId: "wamid.IN2" }));
    expect(r).toMatchObject({ handoffAbierto: false });
    expect(mocks.prisma.conversation.upsert.mock.calls[0][0].update.handoffAt).toBeUndefined();
  });

  it("volver a escribir tras una conversación resuelta la reabre", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "RESOLVED", lastInboundAt: OCURRIO });
    const r = await guardarMensajeEntrante(aviso({ providerMessageId: "wamid.IN3" }));
    expect(r).toMatchObject({ handoffAbierto: true });
  });

  it("un webhook atrasado NO mueve lastInboundAt hacia atrás", async () => {
    // Si retrocediera, cerraría la ventana de 24 h antes de tiempo y el asesor
    // perdería la posibilidad de responder con texto libre.
    const reciente = new Date("2026-08-20T18:00:00.000Z");
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "HUMAN_HANDOFF", lastInboundAt: reciente });
    await guardarMensajeEntrante(aviso({ providerMessageId: "wamid.VIEJO", occurredAt: OCURRIO }));
    expect(mocks.prisma.conversation.upsert.mock.calls[0][0].update.lastInboundAt).toEqual(reciente);
  });

  it("un mensaje más nuevo sí la adelanta", async () => {
    const nuevo = new Date("2026-08-20T20:00:00.000Z");
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "HUMAN_HANDOFF", lastInboundAt: OCURRIO });
    await guardarMensajeEntrante(aviso({ providerMessageId: "wamid.NUEVO", occurredAt: nuevo }));
    expect(mocks.prisma.conversation.upsert.mock.calls[0][0].update.lastInboundAt).toEqual(nuevo);
  });

  it("se guarda el momento de Meta, no el de recepción", async () => {
    await guardarMensajeEntrante(aviso());
    expect(mocks.prisma.inboundMessage.create.mock.calls[0][0].data.occurredAt).toEqual(OCURRIO);
  });
});

describe("asignación heredada", () => {
  it("una conversación nueva hereda el asesor del contacto", async () => {
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1", assignedToId: "admin-1" }]);
    await guardarMensajeEntrante(aviso());
    expect(mocks.prisma.conversation.upsert.mock.calls[0][0].create.assignedToId).toBe("admin-1");
  });

  it("no pisa una asignación que ya existía", async () => {
    // Una decisión tomada a mano manda sobre lo que deduzca el webhook.
    mocks.prisma.lead.findMany.mockResolvedValue([{ id: "lead-1", assignedToId: "admin-1" }]);
    mocks.prisma.conversation.findUnique.mockResolvedValue({ state: "AUTOMATION", assignedToId: "admin-9", leadId: "lead-1" });
    await guardarMensajeEntrante(aviso());
    expect(mocks.prisma.conversation.upsert.mock.calls[0][0].update.assignedToId).toBeUndefined();
  });
});

describe("tipos de mensaje: ninguno rompe", () => {
  function payload(mensaje: Record<string, unknown>) {
    return {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "pni-1" }, messages: [mensaje] } }] }],
    };
  }
  const base = { id: "wamid.X", from: "593999999999", timestamp: "1787000000" };

  it("texto trae su cuerpo", () => {
    const [m] = parseWebhookPayload(payload({ ...base, type: "text", text: { body: "hola" } })).inbound;
    expect(m.text).toBe("hola");
  });

  it("imagen y documento guardan metadatos, no el archivo", () => {
    const [img] = parseWebhookPayload(payload({ ...base, type: "image", image: { id: "media-1", mime_type: "image/jpeg", caption: "mira" } })).inbound;
    expect(img.mediaMeta).toMatchObject({ id: "media-1", mime_type: "image/jpeg" });
    expect(img.text).toBe("mira");

    const [doc] = parseWebhookPayload(payload({ ...base, type: "document", document: { id: "media-2", filename: "guia.pdf" } })).inbound;
    expect(doc.mediaMeta).toMatchObject({ filename: "guia.pdf" });
  });

  it("audio y vídeo no rompen aunque no traigan texto", () => {
    for (const tipo of ["audio", "video"]) {
      const [m] = parseWebhookPayload(payload({ ...base, type: tipo, [tipo]: { id: "media-3", mime_type: "audio/ogg" } })).inbound;
      expect(m.type).toBe(tipo);
      expect(m.text).toBeUndefined();
    }
  });

  it("ubicación guarda coordenadas", () => {
    const [m] = parseWebhookPayload(payload({ ...base, type: "location", location: { latitude: -0.18, longitude: -78.46, name: "Quito" } })).inbound;
    expect(m.mediaMeta).toMatchObject({ latitude: -0.18, name: "Quito" });
  });

  it("contactos guarda un resumen, no la agenda entera", () => {
    const contactos = Array.from({ length: 20 }, (_, i) => ({ name: { formatted_name: `Persona ${i}` }, phones: [{ phone: "+593999999999" }] }));
    const [m] = parseWebhookPayload(payload({ ...base, type: "contacts", contacts: contactos })).inbound;
    expect(m.mediaMeta?.count).toBe(20);
    expect((m.mediaMeta?.names as string[] | undefined)?.length ?? 0).toBeLessThanOrEqual(5);
    expect(JSON.stringify(m.mediaMeta)).not.toContain("+593999999999");
  });

  it("interactive y button dejan el texto elegido", () => {
    const [inter] = parseWebhookPayload(payload({ ...base, type: "interactive", interactive: { type: "button_reply", button_reply: { id: "si", title: "Sí, me interesa" } } })).inbound;
    expect(inter.text).toBe("Sí, me interesa");

    const [btn] = parseWebhookPayload(payload({ ...base, type: "button", button: { text: "Confirmar", payload: "CONFIRM" } })).inbound;
    expect(btn.text).toBe("Confirmar");
  });

  it("reacción guarda el emoji y a qué mensaje responde", () => {
    const [m] = parseWebhookPayload(payload({ ...base, type: "reaction", reaction: { emoji: "👍", message_id: "wamid.OTRO" } })).inbound;
    expect(m.text).toBe("👍");
    expect(m.mediaMeta).toMatchObject({ message_id: "wamid.OTRO" });
  });

  it("un tipo que Meta invente mañana se guarda sin romper", () => {
    // Un 500 aqui haria a Meta reintentar el lote entero indefinidamente.
    const [m] = parseWebhookPayload(payload({ ...base, type: "holograma", holograma: { algo: 1 } })).inbound;
    expect(m.type).toBe("holograma");
    expect(m.mediaMeta).toMatchObject({ unsupportedType: "holograma" });
  });

  it("un mensaje citado conserva a cuál responde", () => {
    const [m] = parseWebhookPayload(payload({ ...base, type: "text", text: { body: "sí" }, context: { id: "wamid.CITADO" } })).inbound;
    expect(m.contextMessageId).toBe("wamid.CITADO");
  });

  it("varios mensajes en un mismo webhook se procesan todos", () => {
    const parsed = parseWebhookPayload({
      object: "whatsapp_business_account",
      entry: [
        { changes: [{ field: "messages", value: { messages: [{ ...base, id: "w1", type: "text", text: { body: "uno" } }, { ...base, id: "w2", type: "text", text: { body: "dos" } }] } }] },
        { changes: [{ field: "messages", value: { messages: [{ ...base, id: "w3", type: "text", text: { body: "tres" } }] } }] },
      ],
    });
    expect(parsed.inbound.map((m) => m.providerMessageId)).toEqual(["w1", "w2", "w3"]);
  });
});
