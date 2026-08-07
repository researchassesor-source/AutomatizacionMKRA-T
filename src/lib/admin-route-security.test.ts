import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCronAuth } from "./cron-auth";

/**
 * Barrera estructural sobre las rutas administrativas.
 *
 * Comprueba el contrato que toda ruta debe cumplir leyendo su código fuente:
 * es lo único que garantiza que una ruta nueva no se publique sin autenticar.
 */
function source(relative: string) {
  return readFileSync(fileURLToPath(new URL(`../app/api/admin/${relative}`, import.meta.url)), "utf8");
}

const ADMIN_ROUTES = [
  "courses/route.ts",
  "courses/[id]/route.ts",
  "courses/[id]/sessions/route.ts",
  "courses/[id]/sessions/[sessionId]/route.ts",
  "courses/catalog/sync/route.ts",
  "automations/route.ts",
  "automations/[id]/route.ts",
  "automations/defaults/route.ts",
  "automations/paused/route.ts",
  "enrollments/route.ts",
  "messages/[id]/route.ts",
  "nurture/dispatch/route.ts",
  "social/posts/route.ts",
  "social/posts/[id]/route.ts",
  "social/publish/route.ts",
  "social/accounts/route.ts",
  "social/accounts/sync-meta/route.ts",
  "social/test/route.ts",
  "email/test/route.ts",
  "users/route.ts",
  "users/[id]/route.ts",
  "leads/[id]/route.ts",
  "leads/export/route.ts",
];

describe("autenticación de rutas administrativas", () => {
  it("toda ruta administrativa exige sesión y rol", () => {
    for (const route of ADMIN_ROUTES) {
      const code = source(route);
      expect(code, `${route} debe exigir rol`).toContain("requireRole(request");
      expect(code, `${route} debe cortar si falta autorización`).toMatch(/if \(auth\.error\) return auth\.error/);
    }
  });

  it("la sala de máquinas queda reservada al perfil técnico", () => {
    // Reactivar reglas puede desencadenar envíos reales, probar el SMTP expone
    // configuración y borrar un contacto destruye el historial de una persona.
    // Nada de esto se entiende sin conocer el funcionamiento interno.
    for (const route of [
      "automations/paused/route.ts",
      "email/test/route.ts",
      "leads/[id]/route.ts",
      "courses/catalog/sync/route.ts",
    ]) {
      expect(source(route), `${route} debe limitarse al perfil técnico`).toMatch(/requireRole\(request, TECNICO\)/);
    }
  });

  it("dirección sí administra usuarios: es un perfil completo, no reducido", () => {
    for (const route of ["users/route.ts", "users/[id]/route.ts"]) {
      expect(source(route), `${route} debe estar abierto a dirección`).toMatch(/requireRole\(request, GESTION\)/);
    }
  });

  it("ninguna ruta conserva una lista de roles escrita a mano", () => {
    // Con dos perfiles, una lista literal olvidada deja a dirección fuera sin
    // motivo aparente. La intención se declara en src/lib/auth/roles.ts.
    for (const route of ADMIN_ROUTES) {
      expect(source(route), `${route} debe citar un grupo con nombre`).not.toMatch(/requireRole\(request, \["/);
    }
  });

  it("las eliminaciones exigen confirmación explícita", () => {
    expect(source("courses/[id]/route.ts")).toContain("confirm");
    expect(source("courses/[id]/sessions/[sessionId]/route.ts")).toContain("z.literal(true)");
    expect(source("social/posts/[id]/route.ts")).toContain("DELETE_LOCAL_DRAFT");
    expect(source("automations/[id]/route.ts")).toContain("DELETE_AUTOMATION");
  });

  it("la recuperación de reglas pausadas exige confirmación", () => {
    expect(source("automations/paused/route.ts")).toContain("z.literal(true)");
  });

  it("ninguna ruta administrativa devuelve secretos al navegador", () => {
    const forbidden = /process\.env\.(SMTP_PASSWORD|META_SYSTEM_USER_TOKEN|META_ACCESS_TOKEN|SESSION_SECRET|CRON_SECRET|TIKTOK_CLIENT_SECRET)/;
    for (const route of ADMIN_ROUTES) {
      expect(source(route), `${route} no debe leer secretos directamente`).not.toMatch(forbidden);
    }
  });
});

describe("autenticación del cron", () => {
  const secret = "secreto-de-prueba-para-el-cron";

  function request(header?: string) {
    return new Request("https://crm.example.test/api/nurture/dispatch", {
      headers: header ? { authorization: header } : undefined,
    });
  }

  it("acepta el secreto correcto", () => {
    process.env.CRON_SECRET = secret;
    expect(checkCronAuth(request(`Bearer ${secret}`))).toBe(true);
  });

  it("rechaza sin cabecera, con secreto incorrecto o con longitud distinta", () => {
    process.env.CRON_SECRET = secret;
    expect(checkCronAuth(request())).toBe(false);
    expect(checkCronAuth(request("Bearer incorrecto"))).toBe(false);
    expect(checkCronAuth(request(`Bearer ${secret}x`))).toBe(false);
    expect(checkCronAuth(request(secret))).toBe(false);
    delete process.env.CRON_SECRET;
  });

  it("los endpoints de cron exigen autenticación en ambos métodos", () => {
    for (const route of ["../app/api/nurture/dispatch/route.ts", "../app/api/social/publish/route.ts"]) {
      const code = readFileSync(fileURLToPath(new URL(route, import.meta.url)), "utf8");
      expect(code).toContain("checkCronAuth");
      expect(code.match(/checkCronAuth/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    }
  });
});
