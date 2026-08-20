import { describe, expect, it } from "vitest";
import { calendarRevisionOf, compareCourseSchedule, planScheduleReconciliation } from "./course-schedule-reconciliation";

const s = (id: string, startAt: string, endAt: string | null = null) => ({ id, startAt: new Date(startAt), endAt: endAt ? new Date(endAt) : null });
const p = (startAt: string, endAt: string | null = null) => ({ startAt, endAt });

describe("compareCourseSchedule", () => {
  it("SIN_CALENDARIO_CRM: el curso no tiene ninguna sesión todavía", () => {
    expect(compareCourseSchedule([], [p("2026-08-25T00:00:00.000Z")])).toBe("SIN_CALENDARIO_CRM");
  });

  it("CALENDARIO_IGUAL: una sola sesión idéntica", () => {
    expect(compareCourseSchedule(
      [s("s1", "2026-08-18T00:00:00.000Z", "2026-08-18T01:30:00.000Z")],
      [p("2026-08-18T00:00:00.000Z", "2026-08-18T01:30:00.000Z")],
    )).toBe("CALENDARIO_IGUAL");
  });

  it("CALENDARIO_IGUAL: varias sesiones idénticas, sin importar el orden de entrada", () => {
    expect(compareCourseSchedule(
      [s("s2", "2026-08-19T00:00:00.000Z"), s("s1", "2026-08-18T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z"), p("2026-08-19T00:00:00.000Z")],
    )).toBe("CALENDARIO_IGUAL");
  });

  it("CALENDARIO_CAMBIADO: cambio de día", () => {
    expect(compareCourseSchedule(
      [s("s1", "2026-08-18T00:00:00.000Z")],
      [p("2026-08-25T00:00:00.000Z")],
    )).toBe("CALENDARIO_CAMBIADO");
  });

  it("CALENDARIO_CAMBIADO: mismo día, cambio de hora", () => {
    expect(compareCourseSchedule(
      [s("s1", "2026-08-18T00:30:00.000Z")],
      [p("2026-08-18T01:30:00.000Z")],
    )).toBe("CALENDARIO_CAMBIADO");
  });

  it("CALENDARIO_CAMBIADO: cambia solo el cierre (endAt)", () => {
    expect(compareCourseSchedule(
      [s("s1", "2026-08-18T00:30:00.000Z", "2026-08-18T01:30:00.000Z")],
      [p("2026-08-18T00:30:00.000Z", "2026-08-18T02:00:00.000Z")],
    )).toBe("CALENDARIO_CAMBIADO");
  });

  it("CALENDARIO_CAMBIADO: cambia la cantidad de sesiones (3 → 2)", () => {
    expect(compareCourseSchedule(
      [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z"), s("s3", "2026-08-20T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z"), p("2026-08-19T00:00:00.000Z")],
    )).toBe("CALENDARIO_CAMBIADO");
  });

  it("CALENDARIO_CAMBIADO: cambia la cantidad de sesiones (2 → 3)", () => {
    expect(compareCourseSchedule(
      [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z"), p("2026-08-19T00:00:00.000Z"), p("2026-08-20T00:00:00.000Z")],
    )).toBe("CALENDARIO_CAMBIADO");
  });
});

describe("planScheduleReconciliation", () => {
  it("A: sin sesiones existentes, todo se crea", () => {
    const plan = planScheduleReconciliation([], [p("2026-08-18T00:00:00.000Z"), p("2026-08-19T00:00:00.000Z")]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.toCreate).toHaveLength(2);
  });

  it("B: calendario idéntico no genera ninguna operación", () => {
    const plan = planScheduleReconciliation(
      [s("s1", "2026-08-18T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z")],
    );
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it("C: preserva el id de la sesión existente al actualizar la fecha", () => {
    const plan = planScheduleReconciliation(
      [s("s1", "2026-08-18T00:00:00.000Z")],
      [p("2026-08-25T00:00:00.000Z")],
    );
    expect(plan.toUpdate).toEqual([{ id: "s1", startAt: new Date("2026-08-25T00:00:00.000Z"), endAt: null }]);
    expect(plan.toRemove).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it("actualiza solo la sesión que realmente cambió, no las que coinciden", () => {
    const plan = planScheduleReconciliation(
      [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z"), p("2026-08-26T00:00:00.000Z")],
    );
    expect(plan.toUpdate).toEqual([{ id: "s2", startAt: new Date("2026-08-26T00:00:00.000Z"), endAt: null }]);
  });

  it("F: reducción de 3 a 2 sesiones cancela por posición cronológica la sobrante (la más tardía)", () => {
    const plan = planScheduleReconciliation(
      [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z"), s("s3", "2026-08-20T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z"), p("2026-08-19T00:00:00.000Z")],
    );
    expect(plan.toRemove).toEqual([{ id: "s3" }]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toCreate).toEqual([]);
  });

  it("G: ampliación de 2 a 3 sesiones crea solo la sesión nueva", () => {
    const plan = planScheduleReconciliation(
      [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z")],
      [p("2026-08-18T00:00:00.000Z"), p("2026-08-19T00:00:00.000Z"), p("2026-08-20T00:00:00.000Z")],
    );
    expect(plan.toCreate).toEqual([{ startAt: new Date("2026-08-20T00:00:00.000Z"), endAt: null }]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRemove).toEqual([]);
  });

  it("empareja por posición cronológica, no por el orden de llegada de los datos", () => {
    const plan = planScheduleReconciliation(
      [s("s-tarde", "2026-08-19T00:00:00.000Z"), s("s-temprano", "2026-08-18T00:00:00.000Z")],
      [p("2026-08-25T00:00:00.000Z"), p("2026-08-26T00:00:00.000Z")],
    );
    // s-temprano (18 ago) es la posición 1 → toma la propuesta más temprana (25).
    // s-tarde (19 ago) es la posición 2 → toma la propuesta más tardía (26).
    expect(plan.toUpdate).toEqual(expect.arrayContaining([
      { id: "s-temprano", startAt: new Date("2026-08-25T00:00:00.000Z"), endAt: null },
      { id: "s-tarde", startAt: new Date("2026-08-26T00:00:00.000Z"), endAt: null },
    ]));
  });
});

describe("calendarRevisionOf", () => {
  it("es estable ante el mismo calendario, sin importar el orden de entrada", () => {
    const a = [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z")];
    const b = [s("s2", "2026-08-19T00:00:00.000Z"), s("s1", "2026-08-18T00:00:00.000Z")];
    expect(calendarRevisionOf(a)).toBe(calendarRevisionOf(b));
  });

  it("cambia si una fecha cambia", () => {
    const antes = [s("s1", "2026-08-18T00:00:00.000Z")];
    const despues = [s("s1", "2026-08-25T00:00:00.000Z")];
    expect(calendarRevisionOf(antes)).not.toBe(calendarRevisionOf(despues));
  });

  it("cambia si la cantidad de sesiones cambia", () => {
    const una = [s("s1", "2026-08-18T00:00:00.000Z")];
    const dos = [s("s1", "2026-08-18T00:00:00.000Z"), s("s2", "2026-08-19T00:00:00.000Z")];
    expect(calendarRevisionOf(una)).not.toBe(calendarRevisionOf(dos));
  });

  it("cambia si solo el cierre (endAt) cambia", () => {
    const a = [s("s1", "2026-08-18T00:00:00.000Z", "2026-08-18T01:00:00.000Z")];
    const b = [s("s1", "2026-08-18T00:00:00.000Z", "2026-08-18T02:00:00.000Z")];
    expect(calendarRevisionOf(a)).not.toBe(calendarRevisionOf(b));
  });

  it("el calendario vacío tiene una huella estable propia", () => {
    expect(calendarRevisionOf([])).toBe(calendarRevisionOf([]));
    expect(calendarRevisionOf([])).not.toBe(calendarRevisionOf([s("s1", "2026-08-18T00:00:00.000Z")]));
  });
});
