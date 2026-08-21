// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    inboundMessage: { updateMany: vi.fn(), findMany: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
    lead: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
  writeAudit: vi.fn(async (_input: any) => undefined),
  requireRole: vi.fn(async () => ({
    session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" },
    error: null,
  })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, distributed: false })),
  recuperarAutomatizacionesDelContacto: vi.fn(async () => 0),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, requestKey: () => "whatsapp-conversation-patch:test" }));
vi.mock("@/lib/whatsapp/handoff-expiry", () => ({ recuperarAutomatizacionesDelContacto: mocks.recuperarAutomatizacionesDelContacto }));

import { GET, PATCH } from "./route";

function patch(id: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`https://crm.example.test/api/admin/whatsapp/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function get(id: string) {
  return GET(new Request(`https://crm.example.test/api/admin/whatsapp/conversations/${id}`), { params: Promise.resolve({ id }) });
}

function conversacion(overrides: Partial<{ leadId: string | null; state: string }> = {}) {
  return {
    id: "conv-1",
    phone: "+593999999999",
    leadId: overrides.leadId === undefined ? "lead-1" : overrides.leadId,
    assignedToId: null,
    state: overrides.state ?? "HUMAN_HANDOFF",
  };
}

/** Fixture para GET: trae el select más amplio que usa el detalle. */
function conversacionDetalle(overrides: Partial<{ leadId: string | null }> = {}) {
  const leadId = overrides.leadId === undefined ? null : overrides.leadId;
  return {
    id: "conv-1",
    phone: "+593999999999",
    state: "AUTOMATION",
    lastInboundAt: new Date("2026-08-20T10:00:00Z"),
    lastOutboundAt: null,
    handoffAt: null,
    resolvedAt: null,
    assignedToId: null,
    assignedTo: null,
    lead: leadId ? { id: leadId, fullName: "Ana Pérez", email: "ana@example.test", enrollments: [] } : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "admin-1", email: "admin@ra-training.com", role: "ADMIN" }, error: null });
  mocks.checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, distributed: false });
  mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion());
  mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.lead.findFirst.mockResolvedValue(null);
  mocks.prisma.lead.update.mockResolvedValue({});
  mocks.prisma.inboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.inboundMessage.findMany.mockResolvedValue([]);
  mocks.prisma.outboundMessage.findMany.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(async (operations: Promise<unknown>[]) => Promise.all(operations));
  mocks.recuperarAutomatizacionesDelContacto.mockResolvedValue(0);
});

/**
 * Cerrar la atención pone al día el calendario del curso del contacto, por
 * si algo cambió mientras duraba (HUMAN_HANDOFF ya no calla ninguna
 * automatización — ver `conversation.ts` — así que esto ya no "reactiva"
 * nada que el handoff hubiera pausado).
 */
describe("PATCH conversación: cerrar atención recupera lo comercial del contacto", () => {
  it("RESOLVED sobre una conversación vinculada reprograma los cursos del contacto vinculado", async () => {
    const res = await patch("conv-1", { state: "RESOLVED" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).toHaveBeenCalledWith("lead-1");
  });

  it("HUMAN_HANDOFF (abrir, no cerrar) no dispara la recuperación", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion({ state: "AUTOMATION" }));
    const res = await patch("conv-1", { state: "HUMAN_HANDOFF" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });

  it("conversación sin contacto vinculado: resuelve sin reventar y sin intentar recuperar nada", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion({ leadId: null }));
    const res = await patch("conv-1", { state: "RESOLVED" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });

  it("vincular un contacto nuevo en la misma petición que resuelve usa el leadId final, no el previo", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacion({ leadId: null }));
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-nuevo", phone: "+593999999999" });
    const res = await patch("conv-1", { state: "RESOLVED", leadId: "lead-nuevo" });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).toHaveBeenCalledWith("lead-nuevo");
  });

  it("una petición sin cambios de estado (solo reasignar) no toca la recuperación", async () => {
    const res = await patch("conv-1", { assignedToId: null });
    expect(res.status).toBe(200);
    expect(mocks.recuperarAutomatizacionesDelContacto).not.toHaveBeenCalled();
  });
});

/**
 * Sección W del release de estabilización: "Este contacto tiene otro
 * número, úsalo y vincula". Sin confirmPhoneUpdate, un teléfono que no
 * coincide sigue rechazándose (comportamiento por defecto, sin cambios).
 */
describe("PATCH conversación: confirmPhoneUpdate ('usar este nuevo número y vincular')", () => {
  it("sin confirmPhoneUpdate, un teléfono que no coincide se rechaza igual que siempre", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", phone: "+593888888888" });
    const res = await patch("conv-1", { leadId: "lead-1" });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errorCode).toBe("PHONE_MISMATCH");
    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
  });

  it("con confirmPhoneUpdate, actualiza el teléfono del contacto y vincula, todo en una transacción", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", phone: "+593888888888" });
    const res = await patch("conv-1", { leadId: "lead-1", confirmPhoneUpdate: true });
    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.lead.update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { phone: "+593999999999" } });
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith({ where: { id: "conv-1" }, data: { leadId: "lead-1" } });
  });

  it("audita como WHATSAPP_CONTACT_PHONE_UPDATED, no como el vínculo normal", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", phone: "+593888888888" });
    await patch("conv-1", { leadId: "lead-1", confirmPhoneUpdate: true });
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "WHATSAPP_CONTACT_PHONE_UPDATED", entityType: "Lead", entityId: "lead-1" }));
  });

  /**
   * Sección 9 de la continuación arquitectónica: un log de auditoría no es
   * el lugar para un teléfono completo, ni el viejo ni el nuevo -- basta con
   * saber QUE cambió (y de qué conversación) para investigar el caso.
   */
  it("la auditoría nunca guarda el teléfono, ni el viejo ni el nuevo", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", phone: "+593888888888" });
    await patch("conv-1", { leadId: "lead-1", confirmPhoneUpdate: true });
    const llamada = mocks.writeAudit.mock.calls.find(([arg]: any) => arg.action === "WHATSAPP_CONTACT_PHONE_UPDATED");
    expect(llamada?.[0].metadata).toEqual({ conversationId: "conv-1", telefonoActualizado: true });
    expect(JSON.stringify(llamada?.[0])).not.toMatch(/\+593/);
  });

  it("si el nuevo número ya pertenece a OTRO contacto, responde 409 sin cambiar nada", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", phone: "+593888888888" });
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead-otro-dueño" });
    const res = await patch("conv-1", { leadId: "lead-1", confirmPhoneUpdate: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorCode).toBe("PHONE_CLAIMED_BY_ANOTHER_LEAD");
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.lead.update).not.toHaveBeenCalled();
  });

  it("nunca toca consent ni classification", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue({ id: "lead-1", phone: "+593888888888" });
    await patch("conv-1", { leadId: "lead-1", confirmPhoneUpdate: true });
    const data = mocks.prisma.lead.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("consent");
    expect(data).not.toHaveProperty("classification");
  });

  it("un contacto inexistente responde 422 sin transacción", async () => {
    mocks.prisma.lead.findUnique.mockResolvedValue(null);
    const res = await patch("conv-1", { leadId: "lead-fantasma", confirmPhoneUpdate: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Sección X del release de estabilización: prueba lógica end-to-end de
 * "inbound sin lead -> crear/vincular -> recargar detalle". El paso de
 * "recargar detalle" depende enteramente de que este GET refleje `linked`
 * correctamente, porque es la bandera que el panel usa para habilitar el
 * compositor de respuesta.
 */
describe("GET conversación: el detalle refleja si está vinculada (recarga tras vincular, sección X)", () => {
  it("sin contacto: linked es false y lead es null", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacionDetalle({ leadId: null }));
    const res = await get("conv-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversation.linked).toBe(false);
    expect(body.conversation.lead).toBeNull();
  });

  it("tras vincularse (buscar existente o crear nuevo), el mismo detalle trae linked:true", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacionDetalle({ leadId: "lead-nuevo" }));
    const res = await get("conv-1");
    const body = await res.json();
    expect(body.conversation.linked).toBe(true);
    expect(body.conversation.lead).toMatchObject({ id: "lead-nuevo", name: "Ana Pérez" });
  });

  it("una conversación inexistente responde 404", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(null);
    const res = await get("conv-fantasma");
    expect(res.status).toBe(404);
  });

  it("mezcla entrantes y salientes en una sola línea de tiempo ordenada, con el autor humano visible", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacionDetalle({ leadId: "lead-1" }));
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([
      { id: "in-1", type: "text", text: "hola", mediaMeta: null, contextMessageId: null, occurredAt: new Date("2026-08-20T09:00:00Z"), readAt: null, providerMessageId: "wamid.IN" },
    ]);
    mocks.prisma.outboundMessage.findMany.mockResolvedValue([
      {
        id: "out-1", body: "hola, ¿en qué te ayudo?", status: "ACEPTADO", origin: "HUMAN",
        scheduledAt: new Date("2026-08-20T09:05:00Z"), acceptedAt: new Date("2026-08-20T09:05:00Z"),
        errorCode: null, providerMessageId: "wamid.OUT", humanActor: { id: "admin-1", name: "Admin" },
      },
    ]);
    const res = await get("conv-1");
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ direction: "INBOUND", origin: "CONTACT" });
    expect(body.messages[1]).toMatchObject({ direction: "OUTBOUND", origin: "HUMAN", actor: "Admin" });
  });
});
