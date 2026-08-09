import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { roleLabel } from "@/lib/auth/role-presentation";
import { CONTENIDO, GESTION, TECNICO } from "@/lib/auth/roles";
import { postStatusPresentation } from "./redes/postPresentation";
import { reviewPresentation } from "./revisar/reviewPresentation";

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const occurrences = (source: string, fragment: string) => source.split(fragment).length - 1;

const socialPage = read("app/admin/redes/page.tsx");
const composer = read("app/admin/redes/PublishComposer.tsx");
const postsBoard = read("app/admin/redes/PostsBoard.tsx");
const redesManager = read("app/admin/redes/RedesManager.tsx");
const reviewPage = read("app/admin/revisar/page.tsx");
const adminNav = read("app/admin/AdminNav.tsx");
const viewSwitch = read("app/admin/ViewSwitch.tsx");
const auditPage = read("app/admin/auditoria/page.tsx");
const leadDetail = read("app/admin/leads/[id]/LeadDetailManager.tsx");
const styles = read("app/globals.css");

describe("Fase 4 · Publicaciones", () => {
  it("Dirección y Técnica comparten un solo compositor moderno", () => {
    expect(occurrences(socialPage, "<PublishComposer")).toBe(1);
  });

  it("Dirección recibe el resumen simple de canales y no diagnóstico", () => {
    expect(socialPage).toContain('<IntegrationStatusPanel technical={false} only={["facebook", "instagram", "tiktok"]} />');
  });

  it("Técnica no renderiza un segundo compositor", () => {
    expect(socialPage).toContain("technicalOnly");
    expect(redesManager).toContain("!technicalOnly ? <section");
  });

  it("el administrador heredado omite compositor, tablero y recurrencias duplicados", () => {
    expect(occurrences(redesManager, "!technicalOnly ? <section")).toBe(3);
  });

  it("las herramientas avanzadas permanecen plegadas de forma nativa", () => {
    expect(socialPage).toContain('<details className="panel social-advanced-tools">');
    expect(socialPage).not.toContain('<details className="panel social-advanced-tools" open>');
  });

  it("las plantillas continúan siendo locales al navegador", () => {
    expect(composer).toContain("window.localStorage.getItem(PLANTILLAS_KEY)");
    expect(composer).toContain("window.localStorage.setItem(PLANTILLAS_KEY");
  });

  it("aplicar una plantilla nunca hereda fecha ni repetición", () => {
    const applyTemplate = composer.slice(composer.indexOf("function usarPlantilla"), composer.indexOf("function renombrar"));
    expect(applyTemplate).toContain('setCuando("")');
    expect(applyTemplate).toContain("setRepetir(false)");
  });

  it("Facebook e Instagram siguen disponibles como destinos", () => {
    expect(composer).toContain('{ platform: "FACEBOOK", label: "Facebook" }');
    expect(composer).toContain('{ platform: "INSTAGRAM", label: "Instagram" }');
  });

  it("Instagram no promete un enlace pulsable en el texto", () => {
    expect(composer).toContain("El enlace no es pulsable en Instagram; va en la biografía.");
  });

  it("el tablero recorta cuerpos largos para conservar escaneo compacto", () => {
    expect(postsBoard).toContain("post.caption.slice(0, 140)");
    expect(postsBoard).not.toContain("<p>{post.caption}</p>");
  });

  it("cada destino muestra su propio estado humano", () => {
    expect(postsBoard).toContain("post.accountName");
    expect(postsBoard).toContain("postStatusPresentation(post.status)");
  });

  it("los fallos no imprimen el detalle crudo del proveedor en la fila", () => {
    expect(postsBoard).not.toContain("post.error.slice");
    expect(postsBoard).toContain("No se pudo enviar a este destino");
  });

  it("los estados de publicación conservan una semántica visual estable", () => {
    expect(postStatusPresentation("PUBLICADO")).toEqual({ label: "Publicado", tone: "ok" });
    expect(postStatusPresentation("PROGRAMADO")).toEqual({ label: "Programado", tone: "warn" });
    expect(postStatusPresentation("FALLIDO")).toEqual({ label: "No salió", tone: "err" });
  });
});

describe("Fase 4 · Revisar", () => {
  it("se presenta como una bandeja de decisiones humanas", () => {
    expect(reviewPage).toContain("Decisiones y ajustes que necesitan una revisión humana");
  });

  it("una configuración pendiente no se presenta como error", () => {
    expect(reviewPresentation("fecha-course", "warn")).toEqual({ category: "configuration", label: "Configuración", tone: "warn" });
  });

  it("una espera externa no se presenta como incidencia", () => {
    expect(reviewPresentation("proveedor-meta", "error")).toEqual({ category: "provider", label: "Esperando proveedor", tone: "info" });
  });

  it("una revisión ordinaria conserva tono informativo", () => {
    expect(reviewPresentation("revision-copy", "warn")).toEqual({ category: "review", label: "Revisión", tone: "info" });
  });

  it("las incidencias reales conservan tono de error", () => {
    expect(reviewPresentation("post-fallido", "error")).toEqual({ category: "incident", label: "Incidencia", tone: "err" });
  });

  it("cada pendiente utiliza la ruta real calculada por el servidor", () => {
    expect(reviewPage).toContain('<Link className="btn-sm" href={item.href}>');
  });

  it("el estado vacío es humano y accionable", () => {
    expect(reviewPage).toContain("Todo al día.");
    expect(reviewPage).toContain("No hay nada pendiente de revisar.");
  });
});

describe("Fase 4 · lenguaje, permisos y pulido global", () => {
  it("ADMIN se presenta únicamente como Técnico", () => {
    expect(roleLabel("ADMIN")).toBe("Técnico");
  });

  it("DIRECCION se presenta únicamente como Dirección", () => {
    expect(roleLabel("DIRECCION")).toBe("Dirección");
  });

  it("las etiquetas no cambian los enums usados por permisos", () => {
    expect(CONTENIDO).toContain("ADMIN");
    expect(CONTENIDO).toContain("DIRECCION");
    expect(GESTION).toEqual(expect.arrayContaining(["ADMIN", "DIRECCION"]));
  });

  it("el centro técnico continúa reservado al enum ADMIN", () => {
    expect(TECNICO).toEqual(["ADMIN"]);
  });

  it("Auditoría continúa comprobando el grupo técnico real", () => {
    expect(auditPage).toContain('session.role !== "ADMIN"');
  });

  it("Dirección sigue sin recibir la sección Sistema", () => {
    expect(adminNav).toMatch(/view === "tecnica"[\s\S]*aria-label="Sistema"/);
  });

  it("la identidad larga del shell conserva el nombre completo como título", () => {
    expect(occurrences(adminNav, "title={name}")).toBeGreaterThanOrEqual(2);
    expect(styles).toContain("text-overflow: ellipsis");
  });

  it("cambiar de vista no persiste etiquetas como roles", () => {
    expect(viewSwitch).not.toMatch(/JSON\.stringify\([^)]*(Técnico|Dirección)/);
    expect(viewSwitch).not.toContain("/api/admin/users");
  });

  it("las herramientas de cuentas no reciben ni renderizan secretos", () => {
    expect(redesManager).not.toContain("accessTokenCipher");
    expect(redesManager).not.toContain("refreshTokenCipher");
    expect(redesManager).not.toContain("accessToken:");
  });

  it("la simulación se presenta en lenguaje humano", () => {
    expect(redesManager).toContain('"En simulación"');
    expect(redesManager).not.toContain('? "SIMULATED"');
  });

  it("el movimiento reducido sigue anulando animaciones", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(/prefers-reduced-motion:[\s\S]*animation: none/);
  });

  it("Publicaciones tiene contratos responsive sin desbordar acciones", () => {
    expect(styles).toContain(".composer-actions > .btn-sm { width: 100%");
    expect(styles).toContain(".post-meta-line { align-items: flex-start; flex-direction: column");
  });

  it("los menús del shell conservan cierre por Escape", () => {
    expect(adminNav).toContain('event.key !== "Escape"');
    expect(adminNav).toContain("event.currentTarget.open = false");
  });

  it("el consentimiento usa una fecha determinista para evitar errores de hidratación", () => {
    expect(leadDetail).toContain("formatEcuadorDateTime(lead.consentAt)");
    expect(leadDetail).not.toContain('new Date(lead.consentAt).toLocaleString("es-EC")');
  });
});
