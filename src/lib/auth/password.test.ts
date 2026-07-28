import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("contraseñas administrativas", () => {
  it("usa un hash scrypt con salt y nunca conserva el texto", async () => {
    const password = "test-password-123";
    const hash = await hashPassword(password);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it("rechaza una contraseña incorrecta", async () => {
    const hash = await hashPassword("test-password-123");
    expect(await verifyPassword("test-password-456", hash)).toBe(false);
  });

  it("rechaza hashes con formato inválido", async () => {
    expect(await verifyPassword("test-password-123", "texto-invalido")).toBe(false);
  });
});
