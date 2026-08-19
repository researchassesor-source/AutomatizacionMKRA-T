// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    course: { findMany: vi.fn(), findUnique: vi.fn() },
  },
  synchronizeWordPressCatalog: vi.fn(),
  proponerCalendario: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/lib/course-schedule-parser", () => ({ proponerCalendario: mocks.proponerCalendario }));
vi.mock("@/lib/wordpress-catalog", () => ({
  synchronizeWordPressCatalog: mocks.synchronizeWordPressCatalog,
  safeWordPressErrorCode: (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    return /^WORDPRESS_[A-Z0-9_]+$/.test(message) ? message : "WORDPRESS_SYNC_FAILED";
  },
}));

import { analyzeWordPressSync } from "./wordpress-sync-orchestrator";

const session = { userId: "admin-1", email: "tecnico@example.test", role: "ADMIN" } as any;

function curso(overrides: Partial<{ id: string; title: string; sessions: any[]; enrollments: number }> = {}) {
  return {
    id: overrides.id ?? "curso-1",
    title: overrides.title ?? "Curso de prueba",
    officialUrl: "https://ra-training.com/cursos/curso-de-prueba/",
    officialCourseUrl: "https://ra-training.com/cursos/curso-de-prueba/",
    sessions: overrides.sessions ?? [{ id: "s1", startAt: new Date("2026-08-20T00:30:00.000Z"), endAt: null }],
    _count: { enrollments: overrides.enrollments ?? 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.synchronizeWordPressCatalog.mockResolvedValue({ createdCourseIds: [] });
  mocks.prisma.course.findMany.mockResolvedValue([]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
});

afterEach(() => vi.unstubAllEnvs());

/**
 * Sección K del release de estabilización: ANALYZE WORDPRESS SYNC en una
 * sola ejecución de servidor -- sincroniza el catálogo, vuelve a leer la
 * lista resultante (nunca la de antes), y lee el calendario de cada curso en
 * el mismo barrido, para que un curso nuevo entre en la misma vuelta que lo
 * descubrió.
 */
describe("analyzeWordPressSync", () => {
  it("sin sesión, falla cerrado sin tocar el catálogo", async () => {
    const resultado = await analyzeWordPressSync(null);
    expect(resultado.ok).toBe(false);
    expect(mocks.synchronizeWordPressCatalog).not.toHaveBeenCalled();
  });

  it("si el catálogo falla (incompleto/vacío/red), no lee ningún calendario", async () => {
    mocks.synchronizeWordPressCatalog.mockRejectedValue(new Error("WORDPRESS_API_EMPTY_CATALOG"));
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.ok).toBe(false);
    expect(resultado.catalogError).toContain("WORDPRESS_API_EMPTY_CATALOG");
    expect(resultado.items).toEqual([]);
    expect(mocks.prisma.course.findMany).not.toHaveBeenCalled();
  });

  it("un curso con el mismo calendario cuenta como UNCHANGED y no aparece en items", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([curso()]);
    mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-08-20T00:30:00.000Z", endAt: null }], fuenteInicio: "Fecha publicada", fuenteHorario: null, horaAsumida: false });
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.ok).toBe(true);
    expect(resultado.totals.unchanged).toBe(1);
    expect(resultado.items).toHaveLength(0);
  });

  it("un curso recién creado por ESTA vuelta del sync se clasifica NEW_COURSE, no SCHEDULE_CHANGED", async () => {
    mocks.synchronizeWordPressCatalog.mockResolvedValue({ createdCourseIds: ["curso-nuevo"] });
    mocks.prisma.course.findMany.mockResolvedValue([curso({ id: "curso-nuevo", sessions: [] })]);
    mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-09-01T00:30:00.000Z", endAt: null }], fuenteInicio: "Fecha publicada", fuenteHorario: null, horaAsumida: false });
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.totals.newCourse).toBe(1);
    expect(resultado.totals.scheduleChanged).toBe(0);
    expect(resultado.items[0]).toMatchObject({ courseId: "curso-nuevo", status: "NEW_COURSE" });
  });

  it("un curso YA existente con fecha distinta se clasifica SCHEDULE_CHANGED", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([curso()]);
    mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-09-15T00:30:00.000Z", endAt: null }], fuenteInicio: "Fecha publicada", fuenteHorario: null, horaAsumida: false });
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.totals.scheduleChanged).toBe(1);
    expect(resultado.items[0]).toMatchObject({ status: "SCHEDULE_CHANGED" });
  });

  it("incluye la cantidad de inscritos por curso, para advertir del impacto de un cambio", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([curso({ enrollments: 12 })]);
    mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-09-15T00:30:00.000Z", endAt: null }], fuenteInicio: "Fecha publicada", fuenteHorario: null, horaAsumida: false });
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.items[0]).toMatchObject({ enrollments: 12 });
  });

  it("un curso sin fecha publicada se clasifica NO_SCHEDULE_SOURCE", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([curso({ sessions: [] })]);
    mocks.proponerCalendario.mockReturnValue({ ok: false, motivo: "La página todavía no anuncia fechas.", fuenteInicio: null, fuenteHorario: null });
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.totals.noScheduleSource).toBe(1);
    expect(resultado.items[0]).toMatchObject({ status: "NO_SCHEDULE_SOURCE", motivo: "La página todavía no anuncia fechas." });
  });

  it("un curso cuya página no responde se clasifica ERROR, sin tumbar el resto del barrido", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([curso({ id: "curso-a" }), curso({ id: "curso-b" })]);
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response("<html></html>", { status: 200 })));
    mocks.proponerCalendario.mockReturnValue({ ok: true, sessions: [{ startAt: "2026-08-20T00:30:00.000Z", endAt: null }], fuenteInicio: "Fecha publicada", fuenteHorario: null, horaAsumida: false });
    const resultado = await analyzeWordPressSync(session);
    expect(resultado.totals.error).toBe(1);
    expect(resultado.totals.unchanged).toBe(1);
    expect(resultado.items).toHaveLength(1);
    expect(resultado.items[0]).toMatchObject({ courseId: "curso-a", status: "ERROR" });
  });

  it("los totales siempre suman la cantidad real de items (más los unchanged, que no aparecen)", async () => {
    mocks.prisma.course.findMany.mockResolvedValue([curso({ id: "c1" }), curso({ id: "c2" }), curso({ id: "c3" })]);
    mocks.proponerCalendario
      .mockReturnValueOnce({ ok: true, sessions: [{ startAt: "2026-08-20T00:30:00.000Z", endAt: null }], fuenteInicio: "x", fuenteHorario: null, horaAsumida: false })
      .mockReturnValueOnce({ ok: false, motivo: "sin fecha", fuenteInicio: null, fuenteHorario: null })
      .mockReturnValueOnce({ ok: true, sessions: [{ startAt: "2026-10-01T00:30:00.000Z", endAt: null }], fuenteInicio: "x", fuenteHorario: null, horaAsumida: false });
    const resultado = await analyzeWordPressSync(session);
    const sumaClasificados = resultado.totals.newCourse + resultado.totals.scheduleChanged + resultado.totals.noScheduleSource + resultado.totals.error;
    expect(resultado.items).toHaveLength(sumaClasificados);
    expect(resultado.totals.unchanged + sumaClasificados).toBe(3);
  });
});
