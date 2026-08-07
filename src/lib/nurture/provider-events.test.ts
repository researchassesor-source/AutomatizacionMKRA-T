// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  prisma: {
    outboundMessage: { findFirst: vi.fn(), update: vi.fn() },
    messageProviderEvent: { create: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({
  writeAudit: mocks.writeAudit,
  sanitizeAuditMetadata: (value: unknown) => value,
}));

import { applyMessageProviderEvent } from "./provider-events";

const OCCURRED = new Date("2026-08-10T12:00:00.000Z");

function evento(overrides: Record<string, any> = {}) {
  return {
    provider: "whatsapp_cloud",
    providerMessageId: "wamid.ABC",
    providerEventId: "wamid.ABC:DELIVERED",
    state: "DELIVERED" as const,
    occurredAt: OCCURRED,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.prisma.outboundMessage.findFirst.mockReset();
  mocks.prisma.outboundMessage.update.mockReset().mockResolvedValue({});
  mocks.prisma.messageProviderEvent.create.mockReset().mockResolvedValue({});
  mocks.writeAudit.mockClear();
});

describe("aplicación de eventos del proveedor", () => {
  it("correlaciona por wamid y avanza el estado", async () => {
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "ACEPTADO", deliveredAt: null });
    const result = await applyMessageProviderEvent(evento());
    expect(mocks.prisma.outboundMessage.findFirst).toHaveBeenCalledWith({
      where: { providerName: "whatsapp_cloud", providerMessageId: "wamid.ABC" },
    });
    expect(result).toMatchObject({ found: true, changed: true, status: "ENTREGADO" });
    expect(mocks.prisma.outboundMessage.update.mock.calls[0][0].data).toMatchObject({ status: "ENTREGADO", deliveredAt: OCCURRED });
  });

  it("un wamid desconocido no crea nada ni falla", async () => {
    // Ocurre con mensajes enviados desde otro sistema o desde el panel de Meta.
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue(null);
    const result = await applyMessageProviderEvent(evento({ providerMessageId: "wamid.DESCONOCIDO" }));
    expect(result).toEqual({ found: false, changed: false });
    expect(mocks.prisma.messageProviderEvent.create).not.toHaveBeenCalled();
    expect(mocks.prisma.outboundMessage.update).not.toHaveBeenCalled();
  });

  it("un reintento de Meta con el mismo evento no vuelve a aplicarse", async () => {
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "ACEPTADO", deliveredAt: null });
    mocks.prisma.messageProviderEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicado", { code: "P2002", clientVersion: "6" }),
    );
    const result = await applyMessageProviderEvent(evento());
    expect(result).toMatchObject({ found: true, changed: false, duplicate: true });
    expect(mocks.prisma.outboundMessage.update).not.toHaveBeenCalled();
  });

  it("un evento fuera de orden se registra pero no retrocede el estado", async () => {
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "LEIDO", deliveredAt: OCCURRED });
    const result = await applyMessageProviderEvent(evento({ state: "SENT", providerEventId: "wamid.ABC:SENT" }));
    // El evento queda en el historial: es información real del proveedor.
    expect(mocks.prisma.messageProviderEvent.create).toHaveBeenCalled();
    expect(result).toMatchObject({ found: true, changed: false });
    expect(mocks.prisma.outboundMessage.update).not.toHaveBeenCalled();
  });

  it("leído completa la marca de entrega si el webhook de entrega se perdió", async () => {
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "ENVIADO", deliveredAt: null });
    await applyMessageProviderEvent(evento({ state: "READ", providerEventId: "wamid.ABC:READ" }));
    expect(mocks.prisma.outboundMessage.update.mock.calls[0][0].data).toMatchObject({
      status: "LEIDO", readAt: OCCURRED, deliveredAt: OCCURRED,
    });
  });

  it("no pisa una fecha de entrega ya registrada", async () => {
    const entregado = new Date("2026-08-10T11:00:00.000Z");
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "ENTREGADO", deliveredAt: entregado });
    await applyMessageProviderEvent(evento({ state: "READ", providerEventId: "wamid.ABC:READ" }));
    expect(mocks.prisma.outboundMessage.update.mock.calls[0][0].data).toMatchObject({ deliveredAt: entregado });
  });

  it("guarda el motivo cuando Meta reporta failed", async () => {
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "ACEPTADO", deliveredAt: null });
    await applyMessageProviderEvent(evento({
      state: "FAILED",
      providerEventId: "wamid.ABC:FAILED",
      errorCode: "WHATSAPP_131047",
      errorMessage: "Re-engagement message",
    }));
    expect(mocks.prisma.outboundMessage.update.mock.calls[0][0].data).toMatchObject({
      status: "FALLIDO", failedAt: OCCURRED, errorCode: "WHATSAPP_131047", errorMessage: "Re-engagement message",
    });
  });

  it("deja constancia en la auditoría de cada transición aplicada", async () => {
    mocks.prisma.outboundMessage.findFirst.mockResolvedValue({ id: "msg-1", status: "ENVIADO", deliveredAt: null });
    await applyMessageProviderEvent(evento());
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "MESSAGE_PROVIDER_STATUS_UPDATED",
      metadata: expect.objectContaining({ from: "ENVIADO", to: "ENTREGADO" }),
    }));
  });
});
