import { describe, expect, it } from "vitest";
import { ecuadorDayBounds, ecuadorLocalDateTimeToIso } from "./time";

describe("zona horaria de Ecuador", () => {
  it("convierte una hora local sin depender de la zona del servidor", () => {
    expect(ecuadorLocalDateTimeToIso("2026-07-28T09:30")).toBe("2026-07-28T14:30:00.000Z");
  });

  it("rechaza fechas de calendario inexistentes", () => {
    expect(() => ecuadorLocalDateTimeToIso("2026-02-31T08:30")).toThrow("Fecha y hora no válidas.");
  });

  it("mantiene el día ecuatoriano cuando UTC ya cambió de fecha", () => {
    const bounds = ecuadorDayBounds(new Date("2026-07-29T02:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-07-28T05:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-07-29T04:59:59.999Z");
  });
});
