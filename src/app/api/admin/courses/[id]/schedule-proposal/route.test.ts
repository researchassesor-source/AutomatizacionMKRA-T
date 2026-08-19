// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  prisma: {
    course: { findUnique: vi.fn() },
    courseSession: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  tx: {
    outboundMessage: { updateMany: vi.fn() },
    courseSession: { deleteMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  },
  rescheduleCourseAutomations: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
  proponerCalendario: vi.fn(),
}));

vi.mock("@/lib/auth/authorization", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/nurture/engine", () => ({ rescheduleCourseAutomations: mocks.rescheduleCourseAutomations }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
// El parseo de HTML ya se prueba a fondo en course-schedule-parser.test.ts
// (incluida su inferencia de año a partir de "ahora"). Aquí solo importa cómo
// la ruta usa el resultado: mockearlo evita fechas frágiles ligadas al
// momento real en que corran las pruebas.
vi.mock("@/lib/course-schedule-parser", () => ({ proponerCalendario: mocks.proponerCalendario }));

import { GET, POST } from "./route";

function getRequest() {
  return new Request("https://crm.example.test/api/admin/courses/course-1/schedule-proposal", { cache: "no-store" });
}
function postRequest(body: unknown) {
  return new Request("https://crm.example.test/api/admin/courses/course-1/schedule-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function params() {
  return { params: Promise.resolve({ id: "course-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ session: { userId: "u1", email: "tecnico@example.test", role: "ADMIN" }, error: null });
  mocks.prisma.$transaction.mockImplementation(async (callback: any) => callback(mocks.tx));
  mocks.rescheduleCourseAutomations.mockResolvedValue({ enrollments: 0, enqueued: 0, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false });
  mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 0 });
  mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-08-27T00:30:00.000Z", endAt: null }], fuenteInicio: "26 de agosto", fuenteHorario: "7:30 pm", horaAsumida: false });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>placeholder</html>", { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET schedule-proposal: clasificación del calendario", () => {
  it("SIN_CALENDARIO_CRM: el curso todavía no tiene ninguna sesión", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [],
    });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("SIN_CALENDARIO_CRM");
    expect(body.ok).toBe(true);
    expect(body.existingSessions).toEqual([]);
  });

  it("CALENDARIO_IGUAL: la fecha existente coincide exactamente con la propuesta", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null,
      sessions: [{ id: "s1", startAt: new Date("2026-08-27T00:30:00.000Z"), endAt: null }],
    });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("CALENDARIO_IGUAL");
  });

  it("CALENDARIO_CAMBIADO: la fecha existente difiere de la publicada", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null,
      sessions: [{ id: "s1", startAt: new Date("2026-08-18T00:30:00.000Z"), endAt: null }],
    });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("CALENDARIO_CAMBIADO");
    expect(body.existingSessions).toEqual([{ startAt: "2026-08-18T00:30:00.000Z", endAt: null }]);
  });

  it("SIN_FECHA_EN_WORDPRESS: la página no publica el campo Inicio (curso sin novedad, no es error)", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [],
    });
    mocks.proponerCalendario.mockReturnValue({ ok: false, motivo: "La página todavía no anuncia fechas.", fuenteInicio: "Próximamente", fuenteHorario: null });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("SIN_FECHA_EN_WORDPRESS");
    expect(body.ok).toBe(false);
  });

  it("ERROR: la página oficial no responde", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [],
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("ERROR");
    expect(mocks.proponerCalendario).not.toHaveBeenCalled();
  });

  it("ERROR: el curso no tiene una URL oficial válida", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: null, officialCourseUrl: null, sessions: [],
    });
    const body = await (await GET(getRequest(), params())).json();
    expect(body.status).toBe("ERROR");
  });

  it("J: solo lee -- una única petición GET a WordPress, ninguna escritura", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({
      id: "course-1", title: "Curso", officialUrl: "https://ra-training.com/curso", officialCourseUrl: null, sessions: [],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>placeholder</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await GET(getRequest(), params());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});

describe("POST schedule-proposal: aplicar un calendario confirmado", () => {
  it("H: sin confirmación literal responde 422 y no toca la base de datos", async () => {
    const response = await POST(postRequest({ sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(422);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
  });

  it("A/D: crea desde cero, reprograma y audita", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([]);
    mocks.rescheduleCourseAutomations.mockResolvedValue({ enrollments: 2, enqueued: 5, updated: 0, omitted: 0, cancelled: 0, batches: 1, truncated: false });

    const response = await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.created).toBe(1);
    expect(mocks.tx.courseSession.create).toHaveBeenCalledWith({ data: { courseId: "course-1", startAt: new Date("2026-08-26T00:30:00.000Z"), endAt: null } });
    expect(mocks.rescheduleCourseAutomations).toHaveBeenCalledWith("course-1");
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "COURSE_SCHEDULE_RECONCILED" }));
  });

  it("D: actualiza una sesión existente preservando su id y reprograma", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1", startAt: new Date("2026-08-18T00:30:00.000Z"), endAt: null }]);

    const response = await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    const body = await response.json();
    expect(body.updated).toBe(1);
    expect(body.created).toBe(0);
    expect(mocks.tx.courseSession.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { startAt: new Date("2026-08-26T00:30:00.000Z"), endAt: null } });
    expect(mocks.tx.courseSession.create).not.toHaveBeenCalled();
  });

  it("B: calendario idéntico no dispara ninguna escritura de sesión", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1", startAt: new Date("2026-08-26T00:30:00.000Z"), endAt: null }]);

    const response = await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-26T00:30:00.000Z", endAt: null }] }), params());
    const body = await response.json();
    expect(body).toMatchObject({ updated: 0, created: 0, removed: 0 });
    expect(mocks.tx.courseSession.update).not.toHaveBeenCalled();
    expect(mocks.tx.courseSession.create).not.toHaveBeenCalled();
    expect(mocks.tx.courseSession.deleteMany).not.toHaveBeenCalled();
  });

  it("F: cancela explícitamente los mensajes pendientes de la sesión sobrante ANTES de eliminarla", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([
      { id: "s1", startAt: new Date("2026-08-18T00:00:00.000Z"), endAt: null },
      { id: "s2", startAt: new Date("2026-08-19T00:00:00.000Z"), endAt: null },
    ]);
    mocks.tx.outboundMessage.updateMany.mockResolvedValue({ count: 4 });

    const response = await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-18T00:00:00.000Z", endAt: null }] }), params());
    const body = await response.json();
    expect(body.removed).toBe(1);
    expect(body.cancelledMessages).toBe(4);
    expect(mocks.tx.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { courseSessionId: { in: ["s2"] }, status: { in: ["PROGRAMADO", "OMITIDO"] } },
      data: expect.objectContaining({ status: "CANCELADO", errorCode: "SESSION_REMOVED" }),
    });
    expect(mocks.tx.courseSession.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s2"] } } });
    const cancelOrder = mocks.tx.outboundMessage.updateMany.mock.invocationCallOrder[0];
    const deleteOrder = mocks.tx.courseSession.deleteMany.mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(deleteOrder);
  });

  it("G: crea la sesión nueva cuando el calendario crece, sin tocar la existente", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1", startAt: new Date("2026-08-18T00:00:00.000Z"), endAt: null }]);

    const response = await POST(postRequest({
      confirm: true,
      sessions: [{ startAt: "2026-08-18T00:00:00.000Z", endAt: null }, { startAt: "2026-08-19T00:00:00.000Z", endAt: null }],
    }), params());
    const body = await response.json();
    expect(body.created).toBe(1);
    expect(mocks.tx.courseSession.create).toHaveBeenCalledWith({ data: { courseId: "course-1", startAt: new Date("2026-08-19T00:00:00.000Z"), endAt: null } });
    expect(mocks.tx.courseSession.update).not.toHaveBeenCalled();
  });

  it("I: si la transacción falla, no hay actualización parcial ni reprogramación", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([{ id: "s1", startAt: new Date("2026-08-18T00:00:00.000Z"), endAt: null }]);
    mocks.prisma.$transaction.mockRejectedValue(new Error("constraint violation"));

    const response = await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(500);
    expect(mocks.rescheduleCourseAutomations).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("J: aplicar el calendario nunca llama a fetch -- WordPress no se toca", async () => {
    mocks.prisma.course.findUnique.mockResolvedValue({ id: "course-1" });
    mocks.prisma.courseSession.findMany.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }] }), params());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exige el rol autorizado antes de tocar cualquier dato", async () => {
    mocks.requireRole.mockResolvedValue({ session: null, error: new Response(null, { status: 403 }) });
    const response = await POST(postRequest({ confirm: true, sessions: [{ startAt: "2026-08-26T00:00:00.000Z", endAt: null }] }), params());
    expect(response.status).toBe(403);
    expect(mocks.prisma.course.findUnique).not.toHaveBeenCalled();
  });
});
