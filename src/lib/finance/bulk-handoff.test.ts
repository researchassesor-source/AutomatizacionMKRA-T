// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn() },
    enrollment: { findMany: vi.fn() },
  },
  confirmEnrollmentWithFinance: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("./handoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handoff")>();
  return { ...actual, confirmEnrollmentWithFinance: mocks.confirmEnrollmentWithFinance };
});

import { executeBulkFinanceHandoff, previewBulkFinanceHandoff } from "./bulk-handoff";

const session = { userId: "u1", email: "tecnico@example.test", role: "ADMIN" } as any;

function enrollment(overrides: Partial<{ id: string; status: string; financeInscripcionId: string | null; leadName: string; modality: string | null; financeServiceId: string | null; sessions: any[] }> = {}) {
  return {
    id: overrides.id ?? "enr-1",
    status: overrides.status ?? "INSCRITO",
    financeInscripcionId: overrides.financeInscripcionId ?? null,
    leadId: "lead-1",
    lead: { firstName: "Ana", lastName: "Pérez", fullName: overrides.leadName ?? "Ana Pérez", email: "ana@example.test", phone: "+593999999999" },
    courseId: "course-1",
    course: {
      title: "Curso de prueba",
      slug: "curso-de-prueba",
      modality: overrides.modality === undefined ? "Virtual" : overrides.modality,
      // Vinculado por defecto: los cursos SIN financeServiceId tienen su
      // propio describe más abajo, para no mezclar esa clasificación con lo
      // que estas pruebas realmente ejercitan (concurrencia, fallos por
      // registro vs. globales).
      financeServiceId: overrides.financeServiceId === undefined ? "SRV-1" : overrides.financeServiceId,
      price: null,
      sessions: overrides.sessions ?? [{ startAt: new Date("2026-09-01T00:30:00.000Z"), endAt: new Date("2026-09-01T02:00:00.000Z"), timezone: "America/Guayaquil" }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.course.findUnique.mockResolvedValue({ title: "Curso de prueba" });
  mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) => {
    if (where.status === "CANCELADO") return [];
    return [enrollment()];
  });
  mocks.confirmEnrollmentWithFinance.mockResolvedValue({ ok: true, simulated: false, financeInscripcionId: "FIN-1", financeUrl: "", verifyUrl: "" });
});

/**
 * Sección T del release de estabilización: "Enviar curso a Finance" desde
 * Contactos. Reutiliza confirmEnrollmentWithFinance (el handoff canónico ya
 * probado) uno por uno; lo nuevo es la clasificación previa y el recorrido
 * con concurrencia acotada.
 */
describe("previewBulkFinanceHandoff", () => {
  it("clasifica una inscripción ya vinculada como YA_VINCULADO", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [] : [enrollment({ financeInscripcionId: "FIN-EXISTENTE" })]);
    const preview = await previewBulkFinanceHandoff("course-1");
    expect(preview.yaVinculados).toBe(1);
    expect(preview.porEnviar).toBe(0);
    expect(preview.items[0].status).toBe("YA_VINCULADO");
  });

  it("clasifica un curso sin modalidad como REQUIERE_CONFIGURACION, con motivo legible", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [] : [enrollment({ modality: null })]);
    const preview = await previewBulkFinanceHandoff("course-1");
    expect(preview.requierenConfiguracion).toBe(1);
    expect(preview.items[0]).toMatchObject({ status: "REQUIERE_CONFIGURACION", motivo: expect.stringContaining("modalidad") });
  });

  /**
   * Sección G del cierre de producción: un curso sin financeServiceId es una
   * brecha de configuración esperada -no una falla de transporte-, y se
   * detecta localmente sin llamar a Finance. Antes esto se clasificaba como
   * POR_ENVIAR y el error genérico solo aparecía al ejecutar de verdad.
   */
  it("clasifica un curso sin financeServiceId como REQUIERE_CONFIGURACION, no como POR_ENVIAR ni error genérico", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [] : [enrollment({ financeServiceId: null })]);
    const preview = await previewBulkFinanceHandoff("course-1");
    expect(preview.porEnviar).toBe(0);
    expect(preview.requierenConfiguracion).toBe(1);
    expect(preview.items[0]).toMatchObject({ status: "REQUIERE_CONFIGURACION", motivo: "Pendiente de configurar en Finance." });
  });

  it("clasifica una inscripción cancelada aparte, sin importar el filtro principal", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [enrollment({ id: "enr-cancelado", status: "CANCELADO" })] : []);
    const preview = await previewBulkFinanceHandoff("course-1");
    expect(preview.cancelados).toBe(1);
    expect(preview.porEnviar).toBe(0);
  });

  it("una inscripción normal y elegible se clasifica POR_ENVIAR", async () => {
    const preview = await previewBulkFinanceHandoff("course-1");
    expect(preview.porEnviar).toBe(1);
  });

  it("curso inexistente lanza un error claro", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    await expect(previewBulkFinanceHandoff("curso-fantasma")).rejects.toThrow("COURSE_NOT_FOUND");
  });
});

describe("executeBulkFinanceHandoff", () => {
  it("envía cada inscripción POR_ENVIAR reutilizando confirmEnrollmentWithFinance", async () => {
    const resultado = await executeBulkFinanceHandoff("course-1", session);
    expect(mocks.confirmEnrollmentWithFinance).toHaveBeenCalledWith("enr-1", session);
    expect(resultado).toMatchObject({ total: 1, enviados: 1, fallidos: 0, fallaGlobal: null });
  });

  it("un fallo POR REGISTRO no detiene el lote: sigue con los demás", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [] : [enrollment({ id: "enr-1" }), enrollment({ id: "enr-2" })]);
    mocks.confirmEnrollmentWithFinance
      .mockRejectedValueOnce(new Error("ENROLLMENT_NOT_ELIGIBLE"))
      .mockResolvedValueOnce({ ok: true, simulated: false, financeInscripcionId: "FIN-2", financeUrl: "", verifyUrl: "" });
    const resultado = await executeBulkFinanceHandoff("course-1", session);
    expect(mocks.confirmEnrollmentWithFinance).toHaveBeenCalledTimes(2);
    expect(resultado).toMatchObject({ enviados: 1, fallidos: 1, fallaGlobal: null });
  });

  it("un fallo GLOBAL (FINANCE_NOT_AVAILABLE) detiene el lote sin agotar el resto", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [] : [enrollment({ id: "enr-1" }), enrollment({ id: "enr-2" }), enrollment({ id: "enr-3" }), enrollment({ id: "enr-4" })]);
    // Concurrencia 3: el primer lote de 3 falla globalmente en el primer ítem.
    mocks.confirmEnrollmentWithFinance.mockRejectedValue(new Error("FINANCE_NOT_AVAILABLE"));
    const resultado = await executeBulkFinanceHandoff("course-1", session);
    expect(resultado.fallaGlobal).toBe("FINANCE_NOT_AVAILABLE");
    // No se procesa el segundo lote (el 4to ítem) tras la falla global del primero.
    expect(mocks.confirmEnrollmentWithFinance).toHaveBeenCalledTimes(3);
  });

  /**
   * Sección 8/L de la continuación arquitectónica: un timeout o la red caída
   * (FINANCE_TRANSPORT_FAILED) es tan global como Finance no disponible --
   * reintentar contra un servicio inalcanzable inscripción por inscripción
   * no tiene sentido. Un problema FUNCIONAL de una sola inscripción, en
   * cambio, nunca detiene a las demás (ya cubierto arriba).
   */
  it("un fallo de TRANSPORTE (timeout/red caída) también detiene el lote como global", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO" ? [] : [enrollment({ id: "enr-1" }), enrollment({ id: "enr-2" }), enrollment({ id: "enr-3" }), enrollment({ id: "enr-4" })]);
    mocks.confirmEnrollmentWithFinance.mockRejectedValue(new Error("FINANCE_TRANSPORT_FAILED"));
    const resultado = await executeBulkFinanceHandoff("course-1", session);
    expect(resultado.fallaGlobal).toBe("FINANCE_TRANSPORT_FAILED");
    expect(mocks.confirmEnrollmentWithFinance).toHaveBeenCalledTimes(3);
  });

  it("no manda las que ya están vinculadas, canceladas o requieren configuración", async () => {
    mocks.prisma.enrollment.findMany.mockImplementation(async ({ where }: any) =>
      where.status === "CANCELADO"
        ? [enrollment({ id: "enr-cancelado", status: "CANCELADO" })]
        : [enrollment({ id: "enr-vinculado", financeInscripcionId: "FIN-X" }), enrollment({ id: "enr-sin-modalidad", modality: null })]);
    const resultado = await executeBulkFinanceHandoff("course-1", session);
    expect(mocks.confirmEnrollmentWithFinance).not.toHaveBeenCalled();
    expect(resultado.total).toBe(0);
  });

  it("recalcula la clasificación al ejecutar, no confía en una lista pasada por el cliente", async () => {
    await executeBulkFinanceHandoff("course-1", session);
    // previewBulkFinanceHandoff internamente vuelve a consultar la base.
    expect(mocks.prisma.enrollment.findMany).toHaveBeenCalled();
  });
});
