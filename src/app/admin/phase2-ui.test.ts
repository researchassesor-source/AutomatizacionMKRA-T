import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TIMELINE_STEPS } from "@/lib/course-timeline";

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const contacts = read("app/admin/leads/page.tsx");
const contactDetail = read("app/admin/leads/[id]/page.tsx");
const contactManager = read("app/admin/leads/[id]/LeadDetailManager.tsx");
const courses = read("app/admin/cursos/page.tsx");
const courseDetail = read("app/admin/cursos/[id]/page.tsx");
const courseCards = read("app/admin/cursos/CourseCards.tsx");
const sessions = read("app/admin/cursos/[id]/CourseSessionsPanel.tsx");
const courseTimeline = read("app/admin/cursos/CourseTimeline.tsx");
const adminNav = read("app/admin/AdminNav.tsx");
const styles = read("app/globals.css");

describe("Fase 2 · listado de contactos", () => {
  it("alinea exactamente seis encabezados con las seis celdas visibles", () => {
    const header = contacts.match(/<thead><tr>(.*?)<\/tr><\/thead>/s)?.[1] ?? "";
    expect(header.match(/<th/g)).toHaveLength(6);
    for (const label of ["Contacto", "Estado", "Curso / interés", "Origen", "Fecha", "Acciones"]) expect(header).toContain(label);
  });

  it("mantiene los filtros primarios de búsqueda, curso, estado, origen y fecha", () => {
    for (const name of ['name="q"', 'name="course"', 'name="stage"', 'name="source"', 'name="from"', 'name="to"']) expect(contacts).toContain(name);
  });

  it("usa el texto de búsqueda solicitado", () => {
    expect(contacts).toContain('placeholder="Buscar por nombre, correo o teléfono"');
  });

  it("reserva responsable, clasificación y orden para filtros avanzados", () => {
    expect(contacts).toMatch(/advanced-filters[\s\S]*name="assignedTo"[\s\S]*name="classification"[\s\S]*name="sort"/);
  });

  it("no muestra campaña UTM como filtro primario", () => {
    const primary = contacts.slice(contacts.indexOf("phase2-contact-filter-grid"), contacts.indexOf("advanced-filters"));
    expect(primary).not.toContain('name="campaign"');
    expect(primary).not.toContain("utmCampaign");
  });

  it("distingue interés registrado de inscripción confirmada", () => {
    expect(contacts).toContain('"Interés registrado"');
    expect(contacts).toContain("Interés, aún no inscrito");
    expect(contacts).toContain("confirmedEnrollment");
  });

  it("agrupa las acciones secundarias en un menú", () => {
    expect(contacts).toContain("<AdminActionMenu");
    expect(contacts).toContain("Ver contacto");
  });

  it("ofrece quitar filtros en el estado vacío", () => {
    expect(contacts).toContain("No encontramos resultados");
    expect(contacts.match(/Quitar filtros/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("adapta la tabla a tarjetas en tablet y móvil", () => {
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.admin-shell \.contacts-table-row/);
    expect(styles).toContain('content: attr(data-label)');
  });
});

describe("Fase 2 · ficha de contacto", () => {
  it("presenta etiquetas explícitas para los datos personales", () => {
    for (const label of ["Nombres", "Apellidos", "Correo electrónico", "WhatsApp", "Etapa comercial"]) expect(contactManager).toContain(`<span>${label}</span>`);
  });

  it("presenta un enlace amigable a la página de origen", () => {
    expect(contactManager).toContain("Ver página de origen ↗");
    expect(contactManager).not.toContain("Abrir página ↗");
  });

  it("oculta notas y seguimientos cuando no existe contenido real", () => {
    expect(contactDetail).toContain("lead.notes.length > 0 || lead.followUps.length > 0");
    expect(contactDetail).not.toContain('title="Sin notas"');
    expect(contactDetail).not.toContain('title="Sin seguimientos"');
  });

  it("humaniza auditoría en cuatro columnas y omite referencias internas", () => {
    const auditHeader = contactDetail.match(/audit-human-table"><thead><tr>(.*?)<\/tr>/s)?.[1] ?? "";
    expect(auditHeader.match(/<th/g)).toHaveLength(4);
    for (const label of ["Fecha", "Origen", "Acción", "Resultado"]) expect(auditHeader).toContain(label);
    expect(auditHeader).not.toContain("Referencia");
  });

  it("Dirección recibe orígenes humanos y Técnica conserva contexto adicional", () => {
    expect(contactDetail).toContain('view === "tecnica" ? actorEmail : "Equipo CRM"');
    expect(contactManager).toContain("Contexto técnico de captación");
    expect(contactManager).toContain('const isTechnical = role === "ADMIN"');
  });

  it("mantiene mensajes como historial principal y actividad como detalle plegable", () => {
    expect(contactDetail).toContain("contact-messages");
    expect(contactDetail).toContain("contact-activity-details");
  });

  it("conserva sin cambios los contratos de edición e inscripción", () => {
    expect(contactManager).toContain('jsonRequest(`/api/admin/leads/$' + '{lead.id}`, "PATCH"');
    expect(contactManager).toContain('jsonRequest(`/api/admin/leads/$' + '{lead.id}`, "DELETE"');
    expect(contactManager).toContain('jsonRequest("/api/admin/enrollments", "POST"');
  });
});

describe("Fase 2 · cursos y sesiones", () => {
  it("mantiene las cuatro pestañas con sus etiquetas de producto", () => {
    for (const label of ["Resumen", "Sesiones", "Inscritos", "Comunicaciones"]) expect(courseDetail).toContain(`label: "${label}"`);
    expect(courseDetail).toContain('{ key: "calendario", label: "Sesiones" }');
  });

  it("presenta cursos compactos con estado, modalidad, inscritos y próxima sesión", () => {
    for (const contract of ["Publicado", "course.modality", "course.enrollments", "course.nextSessionAt"]) expect(courseCards).toContain(contract);
  });

  it("trata enlaces o sesiones pendientes como configuración, no como fallo", () => {
    expect(courseCards).toContain("Requiere configuración: sesión");
    expect(courseCards).toContain("Requiere configuración: enlace");
    expect(courseCards).not.toContain("Falta enlace de acceso");
  });

  it("lleva desde el aviso del resumen a Sesiones", () => {
    expect(courseDetail.match(/Ir a Sesiones/g)?.length).toBeGreaterThanOrEqual(2);
    expect(courseDetail).toContain('tabHref("calendario")');
  });

  it("conserva enlace global y enlace individual de sesión", () => {
    expect(sessions).toContain("Enlace de la reunión para todo el curso");
    expect(sessions).toContain('fetch(`/api/admin/courses/$' + '{courseId}/sessions`,');
    expect(sessions).toContain('fetch(`/api/admin/courses/$' + '{courseId}/sessions/$' + '{sessionId}`,');
  });

  it("mueve eliminar sesión al menú sin alterar DELETE ni confirmación", () => {
    expect(sessions).toContain("<AdminActionMenu");
    expect(sessions).toContain("Eliminar sesión");
    expect(sessions).toContain('method: "DELETE"');
    expect(sessions).toContain("confirm({");
  });

  it("mantiene los cinco momentos oficiales de comunicaciones", () => {
    expect(TIMELINE_STEPS).toHaveLength(5);
    expect(TIMELINE_STEPS.map((step) => step.when)).toEqual(["Al inscribirse", "1 día antes", "2 horas antes", "15 minutos antes", "Al terminar"]);
  });

  it("ofrece una sola llamada a Sesiones cuando la línea requiere configuración", () => {
    expect(courseTimeline).toContain("steps.some((step) => step.blockedReason)");
    expect(courseTimeline.match(/Ir a Sesiones/g)).toHaveLength(1);
    expect(courseTimeline).toContain("Requiere configuración");
  });

  it("conserva WordPress exclusivamente en el bloque técnico existente", () => {
    expect(courses).toMatch(/\{tecnico \? \([\s\S]*<WordPressCatalogSync/);
    expect(courses).toContain("wordpressCatalogConfigured()");
  });
});

describe("Fase 2 · roles y alcance", () => {
  it("mantiene Sistema oculto para Dirección", () => {
    expect(adminNav).toMatch(/view === "tecnica"[\s\S]*aria-label="Sistema"/);
  });

  it("no introduce cambios de API, Prisma o autenticación en componentes visuales nuevos", () => {
    const phase2Presentation = `${contacts}\n${contactDetail}\n${courseCards}\n${courseTimeline}`;
    expect(phase2Presentation).not.toContain("prisma migrate");
    expect(phase2Presentation).not.toContain("db push");
    expect(phase2Presentation).not.toContain("SESSION_SECRET");
  });
});
