import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENIDO, TECNICO } from "@/lib/auth/roles";

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const messages = read("app/admin/mensajes/MessageList.tsx");
const styles = read("app/globals.css");
const archiveButton = read("app/admin/redes/ArchiveSocialPostButton.tsx");
const postsBoard = read("app/admin/redes/PostsBoard.tsx");
const reviewPage = read("app/admin/revisar/page.tsx");
const dashboard = read("lib/dashboard.ts");
const contactDetail = read("app/admin/leads/[id]/LeadDetailManager.tsx");
const feedback = read("app/admin/Feedback.tsx");
const contactRoute = read("app/api/admin/leads/[id]/route.ts");
const schema = read("../prisma/schema.prisma");

describe("correcciones post-producción", () => {
  it("asigna ancho propio a las seis columnas de Comunicaciones sin permitir invasiones", () => {
    expect(messages).toContain('className="message-channel-cell"');
    expect(messages).toContain('className="message-status-cell"');
    expect(messages).toContain('className="message-date-cell"');
    expect(styles).toContain(".message-table { width: 100%; table-layout: fixed; }");
    expect(styles).toContain(".message-table th:nth-child(6) { width: 7%; }");
    expect(styles).toContain("td:not(.row-actions-cell) { overflow: hidden; }");
    expect(styles).toContain(".message-date-cell .muted");
  });

  it("trunca los previews largos y limita la explicación de estado a dos líneas", () => {
    expect(messages).toContain('className="row-title row-truncate"');
    expect(styles).toContain(".row-truncate { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
    expect(styles).toContain("-webkit-line-clamp: 2");
  });

  it("archiva localmente el post fallido y deja de incluirlo en Revisar", () => {
    expect(archiveButton).toContain('method: "PATCH"');
    expect(archiveButton).toContain('action: "archive"');
    expect(dashboard).toContain('where: { status: "FALLIDO" }');
    expect(dashboard).toContain("socialPostId: post.id");
    expect(reviewPage).toContain("<ArchiveSocialPostButton postId={item.socialPostId} />");
    expect(postsBoard).toContain("<ArchiveSocialPostButton postId={post.id} />");
  });

  it("explica expresamente que descartar el aviso no elimina nada en Facebook", () => {
    expect(archiveButton).toContain("Este aviso se quitará del CRM. No se eliminará ninguna publicación de Facebook.");
  });

  it("exige confirmación destructiva antes de eliminar un contacto y muestra feedback", () => {
    expect(contactDetail).toContain('title: "¿Eliminar este contacto?"');
    expect(contactDetail).toContain("Esta acción eliminará el registro del CRM y la información relacionada que el sistema deba eliminar según sus relaciones existentes.");
    expect(contactDetail).toContain('confirmLabel: "Eliminar contacto"');
    expect(contactDetail).toContain('tone: "danger"');
    expect(feedback).toContain("Cancelar");
    expect(contactDetail).toContain('title: "Contacto eliminado"');
    expect(contactDetail).toContain('router.replace("/admin/leads")');
  });

  it("conserva el borrado dirigido por Prisma y las cascadas reales del contacto", () => {
    expect(contactRoute).toContain("prisma.lead.delete({ where: { id } })");
    expect(schema.match(/Lead\s+@relation\(fields: \[leadId\], references: \[id\], onDelete: Cascade\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("Dirección puede descartar avisos operativos y el borrado irreversible sigue técnico", () => {
    expect(CONTENIDO).toContain("DIRECCION");
    expect(TECNICO).toEqual(["ADMIN"]);
    expect(archiveButton).toContain('action: "archive"');
    expect(contactDetail).toContain('const canDelete = role === "ADMIN"');
  });
});
