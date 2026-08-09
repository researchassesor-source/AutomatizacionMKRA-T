import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { presentAdminValue } from "../adminPresentation";

const root = join(process.cwd(), "src");
const adminNav = readFileSync(join(root, "app/admin/AdminNav.tsx"), "utf8");
const viewSwitch = readFileSync(join(root, "app/admin/ViewSwitch.tsx"), "utf8");
const userManager = readFileSync(join(root, "app/admin/usuarios/UserManager.tsx"), "utf8");
const usersPage = readFileSync(join(root, "app/admin/usuarios/page.tsx"), "utf8");
const globalStyles = readFileSync(join(root, "app/globals.css"), "utf8");

describe("presentación de perfiles", () => {
  it("presenta DIRECCION como Dirección y ADMIN como Técnico", () => {
    expect(presentAdminValue("DIRECCION")).toBe("Dirección");
    expect(presentAdminValue("ADMIN")).toBe("Técnico");
  });

  it("un perfil DIRECCION nunca aparece como Administrador", () => {
    expect(presentAdminValue("DIRECCION")).not.toBe("Administrador");
    expect(userManager).not.toContain('ADMIN: "Administrador"');
  });

  it("muestra el perfil como badge y reserva el cambio para una acción explícita", () => {
    expect(userManager).toContain("role-badge");
    expect(userManager).toContain("Cambiar perfil");
    expect(userManager).not.toContain("Rol de $" + "{user.name}");
  });
});

describe("vista Dirección y Técnica", () => {
  it("el selector solo cambia la preferencia visual, no el rol persistido", () => {
    expect(viewSwitch).toContain("document.cookie");
    expect(viewSwitch).not.toContain("/api/admin/users");
    expect(viewSwitch).not.toMatch(/JSON\.stringify\([^)]*role/);
  });

  it("la navegación de Sistema solo se renderiza en vista Técnica", () => {
    expect(adminNav).toMatch(/view === "tecnica"[\s\S]*aria-label="Sistema"/);
  });

  it("Dirección no recibe el diagnóstico y Técnica sí puede desplegarlo", () => {
    expect(usersPage).toMatch(/view === "tecnica" \? <details className="panel access-diagnostic">/);
    expect(usersPage.match(/className="panel access-diagnostic"/g)).toHaveLength(1);
    expect(usersPage).not.toContain("Diagnóstico del acceso heredado");
    expect(usersPage).toContain("Ver diagnóstico");
  });
});

describe("identidad de sesión", () => {
  it("el encabezado cerrado muestra nombre y perfil reales en escritorio", () => {
    const summary = adminNav.slice(adminNav.indexOf("<summary"), adminNav.indexOf("</summary>") + 10);
    expect(summary).toContain('className="admin-user-copy"');
    expect(summary).toContain("{name}");
    expect(summary).toContain("roleLabel(role)");
  });

  it("el dropdown de sesión se cierra con Escape y devuelve el foco", () => {
    expect(adminNav).toContain('event.key !== "Escape"');
    expect(adminNav).toContain('querySelector<HTMLElement>("summary")?.focus()');
  });

  it("no fija nombres de personas de producción en los componentes", () => {
    const productionComponents = `${adminNav}\n${userManager}`;
    expect(productionComponents).not.toContain("Edison Bonifaz");
    expect(productionComponents).not.toContain("Dirección R.A. Training");
  });
});

describe("acciones de usuarios", () => {
  it("mantiene los contratos POST y PATCH existentes", () => {
    expect(userManager).toContain('fetch("/api/admin/users"');
    expect(userManager).toContain("fetch(`/api/admin/users/$" + "{user.id}`");
    expect(userManager).not.toMatch(/method: "(PUT|DELETE)"/);
  });

  it("separa la desactivación y usa la confirmación accesible compartida", () => {
    expect(userManager).toContain("useFeedback");
    expect(userManager).toContain('className={user.isActive ? "is-danger" : ""}');
    expect(userManager).not.toContain("window.confirm");
  });
});

describe("contrato responsive", () => {
  it("mantiene densidad de escritorio y adapta Usuarios a tarjetas en tablet", () => {
    expect(globalStyles).toContain("height: 90px");
    expect(globalStyles).toContain("@media (max-width: 900px)");
    expect(globalStyles).toContain(".admin-shell .users-table-row");
  });

  it("conserva el drawer y reduce la identidad del header en móvil", () => {
    expect(globalStyles).toMatch(/@media \(max-width: 1023px\)[\s\S]*\.admin-sidebar\.is-open/);
    expect(globalStyles).toMatch(/@media \(max-width: 700px\)[\s\S]*\.admin-user-copy \{ display: none; \}/);
  });

  it("respeta movimiento reducido en los nuevos menús", () => {
    expect(globalStyles).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.user-actions-menu[\s\S]*animation: none/);
  });
});
