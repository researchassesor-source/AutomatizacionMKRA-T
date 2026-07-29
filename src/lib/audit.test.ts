import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./audit";

describe("metadatos de auditoría", () => {
  it("elimina secretos anidados y conserva contexto seguro", () => {
    const sanitized = sanitizeAuditMetadata({
      action: "qa",
      nested: {
        password: "no-debe-aparecer",
        Authorization: "Bearer no-debe-aparecer",
        safeReference: "ref-123",
        deeper: [{ token: "no-debe-aparecer", result: "ok" }],
      },
    });
    expect(JSON.stringify(sanitized)).toBe('{"action":"qa","nested":{"safeReference":"ref-123","deeper":[{"result":"ok"}]}}');
  });

  it("limita profundidad, cantidad y longitud", () => {
    const sanitized = sanitizeAuditMetadata({ values: Array.from({ length: 80 }, (_, index) => `x${index}`), text: "x".repeat(800) });
    const parsed = sanitized as { values: string[]; text: string };
    expect(parsed.values).toHaveLength(50);
    expect(parsed.text).toHaveLength(500);
  });
});
