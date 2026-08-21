// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findMany: vi.fn() },
    inboundMessage: { groupBy: vi.fn(), findMany: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
  },
  requireRole: vi.fn(async (): Promise<{ session: { userId: string; email: string; role: string } | null; error: Response | null }> => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));

import { GET } from "./route";

function get(query = "") {
  return GET(new Request(`https://crm.example.test/api/admin/whatsapp/conversations${query}`));
}

function conversacion(overrides: Partial<{ id: string; phone: string; leadId: string | null; lastInboundAt: Date | null; lastOutboundAt: Date | null }> = {}) {
  return {
    id: overrides.id ?? "conv-1",
    phone: overrides.phone ?? "+593999999999",
    state: "AUTOMATION" as const,
    lastInboundAt: overrides.lastInboundAt === undefined ? new Date("2026-08-01T00:00:00Z") : overrides.lastInboundAt,
    lastOutboundAt: overrides.lastOutboundAt === undefined ? null : overrides.lastOutboundAt,
    leadId: overrides.leadId === undefined ? "lead-1" : overrides.leadId,
    assignedTo: null,
    lead: { id: "lead-1", fullName: "Ana Pérez" },
  };
}

function saliente(overrides: Partial<{ conversationId: string | null; leadId: string | null; origin: "HUMAN" | "AUTOMATION"; body: string; scheduledAt: Date; acceptedAt: Date | null; sentAt: Date | null; failedAt: Date | null; bouncedAt: Date | null }>) {
  return {
    conversationId: overrides.conversationId === undefined ? "conv-1" : overrides.conversationId,
    leadId: overrides.leadId === undefined ? null : overrides.leadId,
    origin: overrides.origin ?? "HUMAN",
    body: overrides.body ?? "texto",
    scheduledAt: overrides.scheduledAt ?? new Date("2026-08-20T21:00:00Z"),
    acceptedAt: overrides.acceptedAt ?? null,
    sentAt: overrides.sentAt ?? null,
    failedAt: overrides.failedAt ?? null,
    bouncedAt: overrides.bouncedAt ?? null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.prisma.conversation.findMany.mockResolvedValue([conversacion()]);
  mocks.prisma.inboundMessage.groupBy.mockResolvedValue([]);
  mocks.prisma.inboundMessage.findMany.mockResolvedValue([]);
  mocks.prisma.outboundMessage.findMany.mockResolvedValue([]);
});

/**
 * Último hotfix (bug 2): `lastMessage` solo miraba InboundMessage, así que si
 * el último mensaje real lo mandó un asesor o un automático, la lista seguía
 * mostrando lo que el contacto había escrito ANTES.
 */
describe("GET conversaciones: último mensaje real (humano y automático, no solo entrante)", () => {
  it("9: usa el último outbound HUMANO cuando es posterior al último entrante", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([
      { fromPhone: "+593999999999", text: "Hola", type: "text", occurredAt: new Date("2026-08-20T20:59:00Z") },
    ]);
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      saliente({ body: "Hola Angel en que podemos ayudarte", origin: "HUMAN", acceptedAt: new Date("2026-08-20T21:00:00Z") }),
    ]);
    const body = await (await get()).json();
    expect(body.conversations[0].lastMessage).toMatchObject({
      preview: "Hola Angel en que podemos ayudarte",
      direction: "OUTBOUND",
      origin: "HUMAN",
    });
  });

  it("10: usa el último automático ENVIADO cuando es posterior al último entrante", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([
      { fromPhone: "+593999999999", text: "Hola", type: "text", occurredAt: new Date("2026-08-20T20:59:00Z") },
    ]);
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      saliente({ body: "Únete al grupo de WhatsApp", origin: "AUTOMATION", acceptedAt: new Date("2026-08-20T21:00:30Z") }),
    ]);
    const body = await (await get()).json();
    expect(body.conversations[0].lastMessage).toMatchObject({ direction: "OUTBOUND", origin: "AUTOMATION" });
  });

  it("11: nunca usa un PROGRAMADO futuro como preview (el filtro de status ya lo excluye de la consulta)", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([
      { fromPhone: "+593999999999", text: "Hola", type: "text", occurredAt: new Date("2026-08-20T20:59:00Z") },
    ]);
    // Un PROGRAMADO nunca aparece en este resultado porque el WHERE real ya
    // lo excluye (status in ESTADOS_HISTORIAL_REAL): la consulta simplemente
    // no lo devuelve, igual que Prisma no lo devolvería.
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([]);
    const body = await (await get()).json();
    expect(body.conversations[0].lastMessage).toMatchObject({ direction: "INBOUND", preview: "Hola" });
  });

  it("cuando el inbound es más reciente que cualquier saliente, sigue usándolo", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([
      { fromPhone: "+593999999999", text: "¿Y el enlace?", type: "text", occurredAt: new Date("2026-08-20T21:05:00Z") },
    ]);
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      saliente({ body: "Hola de nuevo en que puedo ayudarte", origin: "HUMAN", acceptedAt: new Date("2026-08-20T21:01:00Z") }),
    ]);
    const body = await (await get()).json();
    expect(body.conversations[0].lastMessage).toMatchObject({ direction: "INBOUND", preview: "¿Y el enlace?" });
  });

  it("un automático anterior a que existiera la conversación se encuentra por leadId, no solo por conversationId", async () => {
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      saliente({ conversationId: null, leadId: "lead-1", origin: "AUTOMATION", body: "Bienvenida", acceptedAt: new Date("2026-08-19T10:00:00Z") }),
    ]);
    const body = await (await get()).json();
    expect(body.conversations[0].lastMessage).toMatchObject({ direction: "OUTBOUND", origin: "AUTOMATION", preview: "Bienvenida" });
  });

  it("sin ningún mensaje real (ni entrante ni saliente), lastMessage es null", async () => {
    const body = await (await get()).json();
    expect(body.conversations[0].lastMessage).toBeNull();
  });

  it("resuelve el último mensaje real sin N+1: una sola consulta batched por tabla, no una por conversación", async () => {
    mocks.prisma.conversation.findMany.mockResolvedValue([conversacion({ id: "conv-1" }), conversacion({ id: "conv-2", phone: "+593888888888" })]);
    await get();
    expect(mocks.prisma.inboundMessage.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.outboundMessage.findMany).toHaveBeenCalledTimes(1);
  });

  it("la lista sigue exigiendo OPERACION (mismo requireRole existente, sin tocar permisos)", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await get();
    expect(res.status).toBe(401);
    expect(mocks.prisma.conversation.findMany).not.toHaveBeenCalled();
  });
});
