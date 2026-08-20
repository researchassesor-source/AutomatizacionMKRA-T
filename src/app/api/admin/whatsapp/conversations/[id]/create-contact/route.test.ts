// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
  prisma: {
    conversation: { findUnique: vi.fn(), update: vi.fn() },
    course: { findFirst: vi.fn() },
    adminUser: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn(), create: vi.fn() },
    inboundMessage: { updateMany: vi.fn() },
    leadEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

import { POST } from "./route";

function peticion(id: string, body: unknown) {
  return POST(
    new Request(`https://crm.example.test/api/admin/whatsapp/conversations/${id}/create-contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.conversation.findUnique.mockResolvedValue({ id: "conv-1", phone: "+593999999999", leadId: null });
  mocks.prisma.lead.findFirst.mockResolvedValue(null);
  mocks.prisma.lead.create.mockImplementation(async ({ data }: any) => ({ id: "lead-nuevo", ...data }));
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.prisma));
});

/**
 * Sección V del release de estabilización: crear contacto desde un
 * inbound de WhatsApp sin vincular. El teléfono viene del servidor
 * (Conversation.phone), nunca del cliente, y consent siempre queda false.
 */
describe("POST whatsapp/conversations/[id]/create-contact", () => {
  it("crea el contacto con el teléfono de la conversación, consent false y classification REAL", async () => {
    const res = await peticion("conv-1", { fullName: "Ana Pérez", confirm: true });
    expect(res.status).toBe(201);
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ fullName: "Ana Pérez", phone: "+593999999999", consent: false, classification: "REAL" }),
    }));
  });

  it("el teléfono nunca lo decide el cliente, aunque lo intente mandar", async () => {
    await peticion("conv-1", { fullName: "Ana Pérez", phone: "+593888888888", confirm: true });
    const data = mocks.prisma.lead.create.mock.calls[0][0].data;
    expect(data.phone).toBe("+593999999999");
  });

  it("vincula la conversación al contacto recién creado, en la misma transacción", async () => {
    await peticion("conv-1", { fullName: "Ana Pérez", confirm: true });
    expect(mocks.prisma.conversation.update).toHaveBeenCalledWith({ where: { id: "conv-1" }, data: { leadId: "lead-nuevo" } });
  });

  it("correo vacío se acepta (es opcional)", async () => {
    const res = await peticion("conv-1", { fullName: "Ana Pérez", email: "", confirm: true });
    expect(res.status).toBe(201);
    expect(mocks.prisma.lead.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "" }) }));
  });

  it("un correo mal formado se rechaza", async () => {
    const res = await peticion("conv-1", { fullName: "Ana Pérez", email: "no-es-un-correo", confirm: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("nombre es obligatorio", async () => {
    const res = await peticion("conv-1", { confirm: true });
    expect(res.status).toBe(422);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("una conversación ya vinculada no permite crear otro contacto", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue({ id: "conv-1", phone: "+593999999999", leadId: "lead-existente" });
    const res = await peticion("conv-1", { fullName: "Ana Pérez", confirm: true });
    expect(res.status).toBe(409);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("si ya existe un contacto con ese número, no crea un duplicado: falla cerrado con el conflicto explícito", async () => {
    mocks.prisma.lead.findFirst.mockResolvedValue({ id: "lead-viejo" });
    const res = await peticion("conv-1", { fullName: "Ana Pérez", confirm: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorCode).toBe("PHONE_ALREADY_REGISTERED");
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("sin confirm explícito se rechaza", async () => {
    const res = await peticion("conv-1", { fullName: "Ana Pérez" });
    expect(res.status).toBe(422);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });

  it("conversación inexistente responde 404", async () => {
    mocks.prisma.conversation.findUnique.mockResolvedValue(null);
    const res = await peticion("conv-fantasma", { fullName: "Ana Pérez", confirm: true });
    expect(res.status).toBe(404);
  });

  it("sin sesión válida no crea nada", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response("no autorizado", { status: 401 }) });
    const res = await peticion("conv-1", { fullName: "Ana Pérez", confirm: true });
    expect(res.status).toBe(401);
    expect(mocks.prisma.lead.create).not.toHaveBeenCalled();
  });
});
