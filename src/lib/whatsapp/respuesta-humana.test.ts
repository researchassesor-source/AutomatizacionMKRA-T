// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    inboundMessage: { findFirst: vi.fn() },
    outboundMessage: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    conversation: { update: vi.fn() },
  },
  send: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/nurture/channels/whatsapp", () => ({
  WhatsAppChannel: class {
    send = mocks.send;
  },
}));
vi.mock("@/lib/whatsapp/config", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  resolveWhatsAppConfig: () => ({ phoneNumberId: "pni", accessToken: "token-de-prueba", graphVersion: "v25.0" }),
  resolveWhatsAppWindow: () => ({ state: "live", liveFrom: new Date("2026-01-01T00:00:00Z") }),
}));

import {
  contextoValido,
  enviarRespuestaHumana,
  plantillaUsableEnBandeja,
  prepararEnvio,
  ventanaDe,
} from "./conversation-service";
import { WHATSAPP_TEMPLATES } from "./templates";

/**
 * Respuesta humana desde la bandeja.
 *
 * Dos cosas no pueden decidirse en el navegador: si la ventana de 24 horas
 * permite texto libre, y que plantilla puede usarse. Un panel puede ocultar un
 * boton, pero una peticion escrita a mano llega igual al servidor.
 */
const AHORA = new Date("2026-08-20T15:00:00.000Z");
const RECIENTE = new Date(AHORA.getTime() - 2 * 3_600_000);
const VIEJO = new Date(AHORA.getTime() - 30 * 3_600_000);

beforeEach(() => {
  mocks.prisma.outboundMessage.create.mockResolvedValue({ id: "out-1" });
  mocks.prisma.outboundMessage.update.mockResolvedValue({});
  mocks.prisma.outboundMessage.findFirst.mockResolvedValue(null);
  mocks.prisma.inboundMessage.findFirst.mockResolvedValue(null);
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.send.mockResolvedValue({ ok: true, providerMessageId: "wamid.OUT", providerName: "whatsapp_cloud" });
});

describe("ventana de atención", () => {
  it("un mensaje reciente permite texto libre", () => {
    const v = ventanaDe(RECIENTE, AHORA);
    expect(v.open).toBe(true);
    expect(v.remainingSeconds).toBeGreaterThan(0);
    expect(v.expiresAt).not.toBeNull();
  });

  it("pasadas 24 h se bloquea el texto y se pide plantilla", () => {
    const v = ventanaDe(VIEJO, AHORA);
    expect(v.open).toBe(false);
    const r = prepararEnvio({ modo: "text", texto: "hola", ventanaAbierta: v.open, variables: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.codigo).toBe("WINDOW_CLOSED_TEMPLATE_REQUIRED");
    expect(r.fallo.estado).toBe(409);
  });

  it("sin mensajes del contacto también está cerrada", () => {
    expect(ventanaDe(null, AHORA).open).toBe(false);
  });

  it("un texto vacío se rechaza aunque la ventana esté abierta", () => {
    const r = prepararEnvio({ modo: "text", texto: "   ", ventanaAbierta: true, variables: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fallo.codigo).toBe("TEXT_EMPTY");
  });
});

describe("plantillas desde la bandeja", () => {
  it("una plantilla del catálogo se acepta", () => {
    expect(plantillaUsableEnBandeja("welcome")).toBeNull();
  });

  it("un nombre inventado desde el navegador se rechaza", () => {
    // Sin esto, el frontend podria pedir cualquier plantilla de Meta.
    expect(plantillaUsableEnBandeja("plantilla_que_no_existe")?.codigo).toBe("TEMPLATE_UNKNOWN");
    expect(plantillaUsableEnBandeja("ra_training_bienvenida_inscripcion")?.codigo).toBe("TEMPLATE_UNKNOWN");
  });

  it("la oferta institucional NO puede dispararse desde una conversación", () => {
    // La gobiernan las campañas, que deciden elegibilidad comercial. Permitirla
    // aquí sería una puerta lateral para saltarse esa decisión.
    expect(plantillaUsableEnBandeja("certification_offer")?.codigo).toBe("TEMPLATE_CAMPAIGN_ONLY");
  });

  it("con contexto completo, se arma con el catálogo canónico", () => {
    const r = prepararEnvio({
      modo: "template",
      templateKey: "course_follow_up",
      ventanaAbierta: false,
      variables: { nombre: "Ana", curso: "Taller", link_curso_completo: "https://ra-training.com/c" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.template?.name).toBe(WHATSAPP_TEMPLATES.course_follow_up.name);
    expect(r.template?.components).toHaveLength(1);
  });

  it("si falta contexto no se inventa un valor", () => {
    // Un hueco relleno con algo plausible llegaría al contacto como si fuera
    // cierto, y nadie lo revisaría.
    const r = prepararEnvio({ modo: "template", templateKey: "course_follow_up", ventanaAbierta: false, variables: { nombre: "Ana" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fallo.codigo).toBe("TEMPLATE_CONTEXT_MISSING");
  });

  it("una plantilla válida sí puede salir con la ventana cerrada", () => {
    const r = prepararEnvio({
      modo: "template",
      templateKey: "survey",
      ventanaAbierta: false,
      variables: { nombre: "Ana", curso: "Taller", link_encuesta: "https://ra-training.com/e" },
    });
    expect(r.ok).toBe(true);
  });
});

describe("mensaje citado", () => {
  it("un wamid de esta conversación es válido", async () => {
    mocks.prisma.inboundMessage.findFirst.mockResolvedValue({ id: "in-1" });
    expect(await contextoValido("+593999999999", "wamid.MIO")).toBe(true);
  });

  it("un wamid ajeno se rechaza: si no, se podría citar el mensaje de otro", async () => {
    expect(await contextoValido("+593999999999", "wamid.AJENO")).toBe(false);
  });

  it("la búsqueda va acotada al teléfono de la conversación", async () => {
    await contextoValido("+593999999999", "wamid.X");
    expect(mocks.prisma.inboundMessage.findFirst.mock.calls[0][0].where).toMatchObject({ fromPhone: "+593999999999" });
  });
});

describe("envío y idempotencia", () => {
  const base = {
    conversationId: "conv-1",
    conversationPhone: "+593999999999",
    leadId: "lead-1",
    enrollmentId: null,
    actorId: "admin-1",
    clientRequestId: "req-abcdefgh",
    cuerpo: "hola",
  };

  it("guarda la respuesta como saliente humano, distinguible de una automatización", async () => {
    const r = await enviarRespuestaHumana(base);
    expect(r.ok).toBe(true);
    const data = mocks.prisma.outboundMessage.create.mock.calls[0][0].data;
    expect(data.origin).toBe("HUMAN");
    expect(data.humanActorId).toBe("admin-1");
    expect(data.conversationId).toBe("conv-1");
    expect(data.clientRequestId).toBe("req-abcdefgh");
    // Sin regla: no la disparó ninguna automatización.
    expect(data.automationRuleId).toBeUndefined();
  });

  it("se crea ANTES de llamar a Meta, para que un corte no deje un envío fantasma", async () => {
    await enviarRespuestaHumana(base);
    const ordenCreate = mocks.prisma.outboundMessage.create.mock.invocationCallOrder[0];
    const ordenEnvio = mocks.send.mock.invocationCallOrder[0];
    expect(ordenCreate).toBeLessThan(ordenEnvio);
  });

  it("guarda el identificador que devuelve Meta, para que los estados lo actualicen", async () => {
    const r = await enviarRespuestaHumana(base);
    expect(r.ok && r.providerMessageId).toBe("wamid.OUT");
    const update = mocks.prisma.outboundMessage.update.mock.calls[0][0].data;
    expect(update.providerMessageId).toBe("wamid.OUT");
    expect(update.status).toBe("ACEPTADO");
  });

  it("el mismo clientRequestId NO envía dos veces", async () => {
    // Es lo que convierte un doble clic en un solo WhatsApp.
    mocks.prisma.outboundMessage.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002", clientVersion: "test", meta: { target: ["conversationId", "clientRequestId"] },
      }),
    );
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "out-previo", providerMessageId: "wamid.PREVIO" });
    const r = await enviarRespuestaHumana(base);
    expect(r).toMatchObject({ ok: true, duplicado: true, outboundId: "out-previo" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("dos peticiones concurrentes producen un solo envío", async () => {
    let creado = false;
    mocks.prisma.outboundMessage.create.mockImplementation(async () => {
      if (creado) {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      }
      creado = true;
      return { id: "out-1" };
    });
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "out-1", providerMessageId: null });
    await Promise.all([enviarRespuestaHumana(base), enviarRespuestaHumana(base)]);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("si Meta rechaza, NO se devuelve éxito y el mensaje queda FALLIDO", async () => {
    mocks.send.mockResolvedValue({ ok: false, errorCode: "WHATSAPP_131047", error: "fuera de ventana", providerName: "whatsapp_cloud" });
    const r = await enviarRespuestaHumana(base);
    expect(r.ok).toBe(false);
    const update = mocks.prisma.outboundMessage.update.mock.calls[0][0].data;
    expect(update.status).toBe("FALLIDO");
    expect(update.errorCode).toBe("WHATSAPP_131047");
  });

  it("la cita viaja al proveedor cuando se indica", async () => {
    await enviarRespuestaHumana({ ...base, replyToProviderMessageId: "wamid.CITADO" });
    expect(mocks.send.mock.calls[0][0].contextMessageId).toBe("wamid.CITADO");
  });

  it("adelanta lastOutboundAt de la conversación", async () => {
    await enviarRespuestaHumana(base);
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conv-1" } }));
  });
});

describe("los endpoints están protegidos", () => {
  const raiz = join(process.cwd(), "src/app/api/admin/whatsapp/conversations");
  const reply = readFileSync(join(raiz, "[id]/reply/route.ts"), "utf8");
  const read = readFileSync(join(raiz, "[id]/read/route.ts"), "utf8");
  const detalle = readFileSync(join(raiz, "[id]/route.ts"), "utf8");
  const lista = readFileSync(join(raiz, "route.ts"), "utf8");

  it("todos exigen sesión con rol", () => {
    for (const [nombre, fuente] of [["reply", reply], ["read", read], ["detalle", detalle], ["lista", lista]] as const) {
      expect(fuente, nombre).toContain("requireRole(request,");
    }
  });

  it("los que escriben están limitados por frecuencia y validados con zod", () => {
    for (const fuente of [reply, read, detalle]) {
      expect(fuente).toContain("checkRateLimit");
    }
    expect(reply).toContain("schema.safeParse");
    expect(detalle).toContain("patchSchema.safeParse");
  });

  it("vincular exige que el teléfono coincida", () => {
    // Vincular a un contacto con otro número mezclaría dos historiales.
    expect(detalle).toContain("PHONE_MISMATCH");
    expect(detalle).toContain("lead.phone !== conversacion.phone");
  });

  it("asignar exige un administrador existente y activo", () => {
    expect(detalle).toContain("isActive: true");
    expect(detalle).toContain("ADMIN_INVALID");
  });

  it("responder exige contacto vinculado en vez de crear uno", () => {
    expect(reply).toContain("CONVERSATION_NOT_LINKED");
    expect(reply).not.toContain("lead.create");
  });

  it("la inscripción indicada tiene que ser del contacto", () => {
    expect(reply).toContain("ENROLLMENT_MISMATCH");
    expect(reply).toContain("leadId: conversacion.leadId");
  });

  it("la lista no expone el teléfono completo ni respuestas del proveedor", () => {
    expect(lista).toContain("telefonoParcial");
    expect(lista).not.toContain("providerResponse");
    expect(detalle).not.toContain("providerResponse");
  });

  it("ninguna consulta va sin límite", () => {
    expect(lista).toContain("take: limit + 1");
    expect(detalle).toContain("take: MAX_MENSAJES");
    expect(read).toContain("take: 200");
  });

  it("marcar leído solo alcanza a los mensajes de esa conversación", () => {
    expect(read).toContain("fromPhone: conversacion.phone");
  });

  it("un fallo de Meta al marcar leído no revierte la lectura local", () => {
    expect(read).toContain("providerWarning");
    const despuesDeMarcar = read.slice(read.indexOf("updateMany"));
    expect(despuesDeMarcar).toContain("marcarLeidoEnMeta");
  });

  it("ningún endpoint devuelve el token ni el secreto", () => {
    for (const fuente of [reply, read, detalle, lista]) {
      expect(fuente).not.toMatch(/accessToken|appSecret|verifyToken/);
    }
  });
});
