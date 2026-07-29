import { afterEach, describe, expect, it, vi } from "vitest";
import { isSameOriginAdminRequest, removesActiveAdministrator, requireRole } from "./authorization";
import { ADMIN_COOKIE, createSessionToken, verifySessionToken } from "./session";
import { checkCronAuth } from "@/lib/cron-auth";
import { canUseLegacyAdminLogin, isLegacyAdminEnabled } from "@/lib/admin-auth";

const adminFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  prisma: { adminUser: { findUnique: adminFindUnique } },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  adminFindUnique.mockReset();
});

async function requestFor(
  role: "ADMIN" | "MARKETING" | "VENTAS" | "LECTURA",
  databaseRole = role,
  isActive = true,
) {
  vi.stubEnv("SESSION_SECRET", "test-only-session-secret-that-is-long");
  adminFindUnique.mockResolvedValue({
    id: "test-user",
    email: "test@example.test",
    name: "Prueba",
    role: databaseRole,
    isActive,
  });
  const token = await createSessionToken({ userId: "test-user", email: "test@example.com", name: "Prueba", role, legacy: false });
  return new Request("http://localhost/api/admin/test", { headers: { cookie: `${ADMIN_COOKIE}=${token}` } });
}

describe("autorización", () => {
  it("permite una ruta ADMIN a ADMIN", async () => expect((await requireRole(await requestFor("ADMIN"), ["ADMIN"])).error).toBeNull());
  it("rechaza una eliminación para LECTURA", async () => expect((await requireRole(await requestFor("LECTURA"), ["ADMIN"])).error?.status).toBe(403));
  it("rechaza acceso sin sesión", async () => expect((await requireRole(new Request("http://localhost/api/admin/test"), ["ADMIN"])).error?.status).toBe(401));
  it("rechaza solicitudes administrativas desde otro origen", () => {
    expect(isSameOriginAdminRequest(new Request("https://preview.example/api/admin/test", { method: "POST", headers: { origin: "https://attacker.example" } }))).toBe(false);
    expect(isSameOriginAdminRequest(new Request("https://preview.example/api/admin/test", { method: "POST", headers: { origin: "https://preview.example" } }))).toBe(true);
  });
  it("rechaza inmediatamente la sesión de un usuario desactivado", async () => {
    expect((await requireRole(await requestFor("ADMIN", "ADMIN", false), ["ADMIN"])).error?.status).toBe(401);
  });
  it("aplica el rol vigente de la base y no el rol antiguo de la cookie", async () => {
    expect((await requireRole(await requestFor("ADMIN", "LECTURA"), ["ADMIN"])).error?.status).toBe(403);
  });
  it("rechaza una cookie alterada", async () => {
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-that-is-long");
    const token = await createSessionToken({ userId: "test-user", email: "test@example.test", name: "Prueba", role: "ADMIN", legacy: false });
    expect(await verifySessionToken(`${token}alterado`)).toBeNull();
  });
  it("rechaza una sesión expirada", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00.000Z"));
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-that-is-long");
    const token = await createSessionToken({ userId: "test-user", email: "test@example.test", name: "Prueba", role: "ADMIN", legacy: false });
    vi.advanceTimersByTime(9 * 60 * 60 * 1000);
    expect(await verifySessionToken(token)).toBeNull();
  });
  it("exige un secreto de sesión explícito y robusto en Producción", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "corto");
    vi.stubEnv("ADMIN_PASSWORD", "legacy-test-password");
    expect(await createSessionToken({ userId: "test-user", email: "test@example.test", name: "Prueba", role: "ADMIN", legacy: false })).toBeNull();
  });
  it("limita el acceso heredado al formulario sin correo", () => {
    vi.stubEnv("ADMIN_PASSWORD", "legacy-test-password");
    vi.stubEnv("ADMIN_LEGACY_LOGIN_ENABLED", "true");
    expect(canUseLegacyAdminLogin("", "legacy-test-password")).toBe(true);
    expect(canUseLegacyAdminLogin("unknown@example.test", "legacy-test-password")).toBe(false);
    expect(canUseLegacyAdminLogin("", "incorrecta")).toBe(false);
  });
  it("permite desactivar explícitamente el acceso heredado", () => {
    vi.stubEnv("ADMIN_PASSWORD", "legacy-test-password");
    vi.stubEnv("ADMIN_LEGACY_LOGIN_ENABLED", "false");
    expect(isLegacyAdminEnabled()).toBe(false);
  });
  it("detecta cambios que retirarían al último administrador activo", () => {
    expect(removesActiveAdministrator({ role: "ADMIN", isActive: true }, { role: "VENTAS" })).toBe(true);
    expect(removesActiveAdministrator({ role: "ADMIN", isActive: true }, { isActive: false })).toBe(true);
    expect(removesActiveAdministrator({ role: "VENTAS", isActive: true }, { isActive: false })).toBe(false);
  });
  it("protege automatizaciones en producción si no hay secreto", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "");
    expect(checkCronAuth(new Request("http://localhost/api/social/publish"))).toBe(false);
  });
  it("acepta el secreto correcto de automatización", () => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    expect(checkCronAuth(new Request("http://localhost/api/social/publish", { headers: { authorization: "Bearer cron-test-secret" } }))).toBe(true);
  });
});
