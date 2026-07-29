import { afterEach, describe, expect, it, vi } from "vitest";
import { computeScore, SCORE_WEIGHTS, UMBRAL_OPORTUNIDAD } from "./scoring";

afterEach(() => vi.useRealTimers());

describe("puntaje comercial", () => {
  it("documenta un umbral estable y pesos positivos", () => {
    expect(UMBRAL_OPORTUNIDAD).toBe(50);
    expect(Object.values(SCORE_WEIGHTS).every((value) => Number.isInteger(value) && value >= 0)).toBe(true);
  });

  it("calcula las señales existentes sin depender de una inscripción automática", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"));
    const result = computeScore(
      { phone: "+593999000001", createdAt: new Date("2026-07-27T12:00:00.000Z") },
      [{ type: "course_completed" }, { type: "course_completed" }],
    );
    expect(result.score).toBe(80);
    expect(result.breakdown.map((item) => item.label)).toContain("Cursos adicionales (1)");
  });
});
