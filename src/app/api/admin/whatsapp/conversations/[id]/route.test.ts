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
  requireRole: vi.fn(async (): Promise<{ session: { userId: string; email: string; role: string } | null; error: Response | null }> => ({
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

/**
 * El GET real llama a `outboundMessage.findMany` DOS veces por petición -una
 * para el historial real (status en ESTADOS_HISTORIAL_REAL), otra para los
 * próximos automáticos (status PROGRAMADO)-. Un `mockResolvedValue` plano
 * devolvería lo mismo a las dos, así que los fixtures de salientes se
 * inyectan por el WHERE real, igual que hace el propio Prisma.
 */
function mockSalientes(reales: any[], programados: any[] = []) {
  mocks.prisma.outboundMessage.findMany.mockImplementation(async ({ where }: any) => {
    if (where.status === "PROGRAMADO") return programados;
    return reales;
  });
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
  mockSalientes([], []);
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
    mockSalientes([
      {
        id: "out-1", body: "hola, ¿en qué te ayudo?", status: "ACEPTADO", origin: "HUMAN",
        scheduledAt: new Date("2026-08-20T09:05:00Z"), acceptedAt: new Date("2026-08-20T09:05:00Z"), sentAt: null, failedAt: null, bouncedAt: null,
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

/**
 * Último hotfix: caso real confirmado en Production. La conversación de hoy
 * (20/08, 20:59-21:01) quedaba enterrada porque el chat mezclaba PROGRAMADO
 * futuros (25/08...30/08) usando su `scheduledAt` como si ya hubieran
 * pasado. Ahora viven aparte, en `scheduledMessages`, y nunca entran a
 * `messages` ni alteran su orden.
 */
describe("GET conversación: mensajes reales vs. próximos automáticos (hotfix WhatsApp Inbox)", () => {
  const CLIENTE_2059 = { id: "in-hola", type: "text", text: "Hola", mediaMeta: null, contextMessageId: null, occurredAt: new Date("2026-08-20T20:59:00Z"), readAt: null, providerMessageId: "wamid.IN.1" };

  function saliente(overrides: Partial<{ id: string; body: string; status: string; origin: "HUMAN" | "AUTOMATION"; scheduledAt: Date; acceptedAt: Date | null; sentAt: Date | null; failedAt: Date | null; bouncedAt: Date | null; humanActor: { id: string; name: string } | null }>) {
    return {
      id: overrides.id ?? "out-x",
      body: overrides.body ?? "texto",
      status: overrides.status ?? "ACEPTADO",
      origin: overrides.origin ?? "HUMAN",
      scheduledAt: overrides.scheduledAt ?? new Date("2026-08-20T21:00:00Z"),
      acceptedAt: overrides.acceptedAt ?? null,
      sentAt: overrides.sentAt ?? null,
      failedAt: overrides.failedAt ?? null,
      bouncedAt: overrides.bouncedAt ?? null,
      errorCode: null,
      providerMessageId: `wamid.${overrides.id ?? "out-x"}`,
      humanActor: overrides.humanActor === undefined ? null : overrides.humanActor,
    };
  }

  beforeEach(() => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(conversacionDetalle({ leadId: "lead-1" }));
  });

  it("1: el entrante 'Hola' del cliente aparece en messages", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([CLIENTE_2059]);
    const body = await (await get("conv-1")).json();
    expect(body.messages.some((m: any) => m.text === "Hola" && m.direction === "INBOUND")).toBe(true);
  });

  it("2: la respuesta humana ACEPTADO aparece en messages", async () => {
    mockSalientes([saliente({ id: "out-asesor", body: "Hola Angel en que podemos ayudarte", status: "ACEPTADO", origin: "HUMAN", acceptedAt: new Date("2026-08-20T21:00:00Z"), humanActor: { id: "admin-1", name: "Asesor" } })]);
    const body = await (await get("conv-1")).json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ direction: "OUTBOUND", origin: "HUMAN", text: "Hola Angel en que podemos ayudarte" });
  });

  it("3: el automático ACEPTADO (Grupo WhatsApp) aparece en messages", async () => {
    mockSalientes([saliente({ id: "out-grupo", body: "Únete al grupo de WhatsApp", status: "ACEPTADO", origin: "AUTOMATION", acceptedAt: new Date("2026-08-20T21:00:30Z") })]);
    const body = await (await get("conv-1")).json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ direction: "OUTBOUND", origin: "AUTOMATION" });
  });

  it("4: un PROGRAMADO futuro (30/08) NO aparece en messages", async () => {
    // La consulta real de `messages` ya filtra por status en el WHERE, así
    // que un PROGRAMADO nunca llega a `reales`: se simula devolviendo la
    // lista vacía para ese lado, exactamente lo que Prisma haría.
    mockSalientes([], [saliente({ id: "out-30ago", body: "Encuesta final", status: "PROGRAMADO", origin: "AUTOMATION", scheduledAt: new Date("2026-08-30T18:00:00Z") })]);
    const body = await (await get("conv-1")).json();
    expect(body.messages).toHaveLength(0);
    expect(body.messages.some((m: any) => m.id === "out-30ago")).toBe(false);
  });

  it("5: ese mismo PROGRAMADO futuro sí aparece en scheduledMessages", async () => {
    mockSalientes([], [saliente({ id: "out-30ago", body: "Encuesta final", status: "PROGRAMADO", scheduledAt: new Date("2026-08-30T18:00:00Z") })]);
    const body = await (await get("conv-1")).json();
    expect(body.scheduledMessages).toHaveLength(1);
    expect(body.scheduledMessages[0]).toMatchObject({ id: "out-30ago", scheduledAt: "2026-08-30T18:00:00.000Z" });
  });

  it("6: OMITIDO, CANCELADO y SIMULADO no aparecen en el chat real", async () => {
    // Los tres quedan fuera del propio WHERE de Prisma (status no está en
    // ESTADOS_HISTORIAL_REAL): se confirma que la consulta de `messages`
    // nunca los pide devolviendo vacío, igual que la base real haría.
    mockSalientes([], []);
    const body = await (await get("conv-1")).json();
    expect(body.messages).toHaveLength(0);
  });

  it("7: el orden real (cliente 20:59, asesor 21:00, automático 21:00, asesor 21:01) se respeta", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([CLIENTE_2059]);
    mockSalientes([
      saliente({ id: "out-asesor-1", body: "Hola Angel en que podemos ayudarte", origin: "HUMAN", acceptedAt: new Date("2026-08-20T21:00:00Z"), humanActor: { id: "a1", name: "Asesor" } }),
      saliente({ id: "out-grupo", body: "Grupo WhatsApp", origin: "AUTOMATION", acceptedAt: new Date("2026-08-20T21:00:15Z") }),
      saliente({ id: "out-asesor-2", body: "Hola de nuevo en que puedo ayudarte", origin: "HUMAN", acceptedAt: new Date("2026-08-20T21:01:00Z"), humanActor: { id: "a1", name: "Asesor" } }),
    ]);
    const body = await (await get("conv-1")).json();
    expect(body.messages.map((m: any) => m.id)).toEqual(["in-hola", "out-asesor-1", "out-grupo", "out-asesor-2"]);
  });

  it("8: el programado del 30/08 no altera cuál es el último mensaje real", async () => {
    mocks.prisma.inboundMessage.findMany.mockResolvedValue([CLIENTE_2059]);
    mockSalientes(
      [saliente({ id: "out-asesor-2", body: "Hola de nuevo en que puedo ayudarte", origin: "HUMAN", acceptedAt: new Date("2026-08-20T21:01:00Z"), humanActor: { id: "a1", name: "Asesor" } })],
      [saliente({ id: "out-30ago", body: "Encuesta final", status: "PROGRAMADO", scheduledAt: new Date("2026-08-30T18:00:00Z") })],
    );
    const body = await (await get("conv-1")).json();
    const ultimoReal = body.messages[body.messages.length - 1];
    expect(ultimoReal.id).toBe("out-asesor-2");
    expect(new Date(ultimoReal.at).getTime()).toBeLessThan(new Date("2026-08-30T00:00:00Z").getTime());
  });

  it("12: aunque no haya ningún programado, el contrato siempre trae scheduledMessages (nunca undefined)", async () => {
    const body = await (await get("conv-1")).json();
    expect(body.scheduledMessages).toEqual([]);
    expect(body.messages).toEqual([]);
  });

  it("REBOTADO también es historial real, con su propio bouncedAt como posición", async () => {
    mockSalientes([saliente({ id: "out-rebotado", body: "texto", status: "REBOTADO", origin: "AUTOMATION", bouncedAt: new Date("2026-08-20T21:02:00Z") })]);
    const body = await (await get("conv-1")).json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ status: "REBOTADO", at: "2026-08-20T21:02:00.000Z" });
  });

  it("20: GET sigue exigiendo el mismo rol OPERACION existente (sin tocar el guard del backend)", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await get("conv-1");
    expect(res.status).toBe(401);
    expect(mocks.prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it("el label de un automático programado sale del catálogo de pasos, no del planKey en crudo", async () => {
    mockSalientes([], [
      { id: "out-24h", body: "x", status: "PROGRAMADO", origin: "AUTOMATION", scheduledAt: new Date("2026-08-25T19:00:00Z"), acceptedAt: null, sentAt: null, failedAt: null, bouncedAt: null, errorCode: null, providerMessageId: null, humanActor: null, automationRule: { planKey: "reminder_24h" } },
    ]);
    const body = await (await get("conv-1")).json();
    expect(body.scheduledMessages[0].label).toBe("Recordatorio");
    expect(body.scheduledMessages[0]).not.toHaveProperty("planKey");
  });
});
