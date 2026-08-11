// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles representan respuestas parciales controladas de Prisma.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    enrollment: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    leadEvent: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    enrollment: { update: vi.fn() },
    lead: { updateMany: vi.fn() },
    leadEvent: { upsert: vi.fn() },
  },
  createInscripcion: vi.fn(),
  isFinanceConfigured: vi.fn(() => true),
  isFinanceSimulation: vi.fn(() => false),
  writeAudit: vi.fn(async () => undefined),
  scheduleEnrollmentAutomations: vi.fn(async () => ({ enqueued: 0 })),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/nurture/engine", () => ({ scheduleEnrollmentAutomations: mocks.scheduleEnrollmentAutomations }));
vi.mock("./client", () => ({
  createInscripcion: mocks.createInscripcion,
  financeEnrollmentUrl: (id: string) => `https://finance.example.test/inscripciones/${id}`,
  financeVerificationUrl: (id: string) => `https://finance.example.test/verificar/${id}`,
  isFinanceConfigured: mocks.isFinanceConfigured,
  isFinanceSimulation: mocks.isFinanceSimulation,
}));

import { confirmEnrollmentWithFinance, handoffEnrollment } from "./handoff";

const enrollment = {
  id: "enrollment-1",
  leadId: "contact-1",
  courseId: "course-1",
  status: "INTERESADO",
  financeStatus: "NO_ENVIADO",
  financeInscripcionId: null,
  lead: {
    id: "contact-1",
    firstName: "Ana",
    lastName: "Pérez",
    fullName: "Ana Pérez",
    email: "ana@example.test",
    phone: "+593999999999",
    stage: "NUEVO",
  },
  course: {
    id: "course-1",
    slug: "ia-apoyo-tareas-estudiantiles",
    title: "IA para Apoyo en Tareas Académicas",
    modality: "Virtual en vivo",
    price: null,
    startsAt: null,
    endsAt: null,
    streamUrl: null,
    sessions: [
      { id: "session-2", title: null, startAt: new Date("2026-08-12T00:30:00.000Z"), endAt: new Date("2026-08-12T02:00:00.000Z"), streamUrl: null, timezone: "America/Guayaquil" },
      { id: "session-1", title: null, startAt: new Date("2026-08-11T00:30:00.000Z"), endAt: new Date("2026-08-11T02:00:00.000Z"), streamUrl: null, timezone: "America/Guayaquil" },
    ],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isFinanceConfigured.mockReturnValue(true);
  mocks.isFinanceSimulation.mockReturnValue(false);
  mocks.prisma.enrollment.findUnique.mockResolvedValue(structuredClone(enrollment));
  mocks.prisma.enrollment.updateMany.mockResolvedValue({ count: 1 });
  mocks.createInscripcion.mockResolvedValue({ id: "finance-1" });
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
});

describe("confirmación CRM a Finance", () => {
  it("cambia INTERESADO a INSCRITO solo después del éxito y guarda la referencia", async () => {
    const result = await confirmEnrollmentWithFinance("enrollment-1");
    expect(result.financeInscripcionId).toBe("finance-1");
    expect(mocks.tx.enrollment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "enrollment-1" },
      data: expect.objectContaining({ status: "INSCRITO", financeStatus: "ENVIADO", financeInscripcionId: "finance-1" }),
    }));
    expect(mocks.scheduleEnrollmentAutomations).toHaveBeenCalledWith("enrollment-1");
  });

  it("envía crmEnrollmentId estable, contacto, curso, modalidad y rango real", async () => {
    await confirmEnrollmentWithFinance("enrollment-1");
    expect(mocks.createInscripcion).toHaveBeenCalledWith(expect.objectContaining({
      crmEnrollmentId: "enrollment-1",
      crmContactId: "contact-1",
      crmCourseId: "course-1",
      modality: "Virtual en vivo",
      startDate: "2026-08-11T00:30:00.000Z",
      endDate: "2026-08-12T02:00:00.000Z",
      participant: expect.objectContaining({ fullName: "Ana Pérez", identification: null }),
    }));
  });

  it("ante error conserva INTERESADO, registra ERROR y permite reintentar con la misma identidad", async () => {
    mocks.createInscripcion.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ id: "finance-1" });
    await expect(confirmEnrollmentWithFinance("enrollment-1")).rejects.toThrow("timeout");
    expect(mocks.prisma.enrollment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { financeStatus: "ERROR", lastHandoffError: "Finance no pudo procesar la inscripción." },
    }));
    expect(mocks.tx.enrollment.update).not.toHaveBeenCalled();
    await confirmEnrollmentWithFinance("enrollment-1");
    const identities = mocks.createInscripcion.mock.calls.map(([payload]) => payload.crmEnrollmentId);
    expect(identities).toEqual(["enrollment-1", "enrollment-1"]);
  });

  it("no duplica un Enrollment ya enviado y reconcilia un estado histórico", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue({
      ...structuredClone(enrollment),
      financeStatus: "ENVIADO",
      financeInscripcionId: "finance-existing",
    });
    const result = await confirmEnrollmentWithFinance("enrollment-1");
    expect(result.reused).toBe(true);
    expect(mocks.createInscripcion).not.toHaveBeenCalled();
    expect(mocks.tx.enrollment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "INSCRITO", financeStatus: "ENVIADO" }),
    }));
  });

  it("rechaza CANCELADO y bloquea operaciones concurrentes antes de llamar a Finance", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue({ ...structuredClone(enrollment), status: "CANCELADO" });
    await expect(confirmEnrollmentWithFinance("enrollment-1")).rejects.toThrow("ENROLLMENT_NOT_ELIGIBLE");
    expect(mocks.createInscripcion).not.toHaveBeenCalled();

    mocks.prisma.enrollment.findUnique.mockResolvedValue(structuredClone(enrollment));
    mocks.prisma.enrollment.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmEnrollmentWithFinance("enrollment-1")).rejects.toThrow("HANDOFF_IN_PROGRESS");
    expect(mocks.createInscripcion).not.toHaveBeenCalled();
  });

  it("no retrocede una etapa comercial avanzada", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue({
      ...structuredClone(enrollment),
      lead: { ...structuredClone(enrollment.lead), stage: "CLIENTE" },
    });
    await confirmEnrollmentWithFinance("enrollment-1");
    expect(mocks.tx.lead.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", stage: "NUEVO" },
      data: { stage: "INSCRITO" },
    });
  });

  it("COMPLETADO con referencia Finance no crea una segunda inscripción", async () => {
    mocks.prisma.enrollment.findUnique.mockResolvedValue({
      ...structuredClone(enrollment),
      status: "COMPLETADO",
      financeStatus: "ENVIADO",
      financeInscripcionId: "finance-existing",
    });
    await handoffEnrollment("enrollment-1");
    expect(mocks.createInscripcion).not.toHaveBeenCalled();
  });
});
