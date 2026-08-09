import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEGRATION_STATE_LABELS } from "@/lib/integration-status";
import { estadoVisibleDe } from "@/lib/message-states";
import { presentAuditAction, presentAuditArea, redactAuditMetadata } from "./adminPresentation";

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const messagesPage = read("app/admin/mensajes/page.tsx");
const messageList = read("app/admin/mensajes/MessageList.tsx");
const messageActions = read("app/admin/mensajes/MessageActions.tsx");
const integrationPanel = read("app/admin/IntegrationStatusPanel.tsx");
const healthStrip = read("app/admin/HealthStrip.tsx");
const automationsPage = read("app/admin/automatizaciones/page.tsx");
const automationManager = read("app/admin/automatizaciones/AutomationManager.tsx");
const auditPage = read("app/admin/auditoria/page.tsx");
const auditTable = read("app/admin/auditoria/AuditLogTable.tsx");
const adminNav = read("app/admin/AdminNav.tsx");
const adminSession = read("app/admin/AdminSession.tsx");
const viewSwitch = read("app/admin/ViewSwitch.tsx");

describe("Fase 3 · Centro técnico y comunicaciones", () => {
  it("resuelve la vista de integraciones antes de consultar la bandeja", () => {
    expect(messagesPage.indexOf('filters.vista === "integraciones"')).toBeLessThan(messagesPage.indexOf("prisma.outboundMessage.findMany"));
  });

  it("la vista de integraciones carga primero la superficie técnica", () => {
    expect(messagesPage).toContain('title="Centro técnico"');
    expect(messagesPage).toContain("<HealthStrip />");
    expect(messagesPage).toContain("<IntegrationStatusPanel technical />");
  });

  it("Dirección no recibe diagnóstico al intentar la URL técnica", () => {
    expect(messagesPage).toMatch(/filters\.vista === "integraciones"[\s\S]*if \(!technical\)[\s\S]*Acceso restringido/);
  });

  it("la tabla no incrusta el cuerpo completo de los mensajes", () => {
    const table = messageList.slice(messageList.indexOf('<table className="data message-table">'), messageList.indexOf("{selected ? ("));
    expect(table).not.toContain("message.body");
    expect(table).not.toContain("selected.body");
  });

  it("el detalle humano y el diagnóstico técnico están separados", () => {
    expect(messageList).toContain("Detalle de comunicación");
    expect(messageList).toContain("<TechnicalSection visible={technical}>");
    expect(messageList).toContain("Ver detalle técnico");
  });

  it("agrupa las acciones secundarias de cada mensaje", () => {
    expect(messageActions).toContain("<AdminActionMenu");
    expect(messageActions).toContain("Ver detalle");
  });

  it("preserva los enums internos y solo humaniza la etiqueta", () => {
    expect(estadoVisibleDe("SIMULADO", new Date()).label).toBe("En simulación");
    expect(messageList).toContain("message.status");
  });

  it("WhatsApp deshabilitado o simulado no se presenta como error", () => {
    expect(healthStrip).toMatch(/whatsapp\.mode === "disabled" \? "warn"/);
    expect(healthStrip).toContain('"en simulación"');
  });

  it("la revisión externa no se presenta como fallo", () => {
    expect(INTEGRATION_STATE_LABELS.PENDING_EXTERNAL_VERIFICATION).toBe("En revisión externa");
    expect(INTEGRATION_STATE_LABELS.PENDING_PROVIDER_APPROVAL).toBe("Esperando proveedor");
  });

  it("no expone identificadores de proveedor en el resumen primario", () => {
    const primaryCard = integrationPanel.slice(integrationPanel.indexOf("integration-card-grid"), integrationPanel.indexOf("<details>"));
    expect(primaryCard).not.toContain("status.detail");
    expect(primaryCard).not.toContain("status.nextStep");
  });

  it("la paginación de mensajes conserva el conjunto y amplía la presentación", () => {
    expect(messageList).toContain("messages.slice(0, visibleCount)");
    expect(messageList).toContain("count + pageSize");
    expect(messageList).toContain('<option value="25">25</option>');
    expect(messageList).toContain('<option value="50">50</option>');
  });
});

describe("Fase 3 · automatizaciones", () => {
  it("los contadores salen de las reglas reales y no de un número fijo", () => {
    expect(automationsPage).toContain("rules.length");
    expect(automationsPage).toContain("activeRules");
    expect(automationsPage).toContain("attentionRules");
    expect(automationsPage).not.toContain("<strong>5</strong>");
  });

  it("los filtros de presentación no llaman endpoints ni mutan reglas", () => {
    const filters = automationManager.slice(automationManager.indexOf("phase3-automation-filter-grid"), automationManager.indexOf("filteredRules.length === 0"));
    expect(filters).not.toContain("fetch(");
    expect(filters).not.toContain("request(");
  });

  it("conserva los contratos existentes de creación, actualización y borrado", () => {
    for (const contract of ['request("/api/admin/automations", "POST"', `request(\`/api/admin/automations/\${rule.id}\`, "PATCH"`, `request(\`/api/admin/automations/\${rule.id}\`, "DELETE"`]) expect(automationManager).toContain(contract);
  });

  it("agrupa acciones de reglas y campañas en el menú compartido", () => {
    expect(automationManager.match(/<AdminActionMenu/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Fase 3 · auditoría, seguridad visual y shell", () => {
  it("traduce acción, área y entidad sin reemplazar claves persistidas", () => {
    expect(presentAuditAction("AUTH_LOGIN")).toBe("Inicio de sesión");
    expect(presentAuditArea("AUTH_LOGIN", "AdminUser")).toBe("Acceso");
    expect(presentAuditArea("MESSAGE_SIMULATED", "OutboundMessage")).toBe("Comunicaciones");
  });

  it("mantiene los metadatos fuera de la tabla y plegados en detalle técnico", () => {
    const table = auditTable.slice(auditTable.indexOf("<table"), auditTable.indexOf("{selected ?"));
    expect(table).not.toContain("JSON.stringify");
    expect(auditTable).toContain("Ver metadatos depurados");
    expect(auditTable).toContain("<TechnicalSection visible={technical}>");
  });

  it("redacta secretos, tokens y credenciales antes de presentarlos", () => {
    expect(redactAuditMetadata({ token: "qa-token", nested: { password: "qa-pass", safe: "visible" } })).toEqual({ token: "[oculto]", nested: { password: "[oculto]", safe: "visible" } });
  });

  it("la paginación de auditoría no descarta registros del arreglo recibido", () => {
    expect(auditTable).toContain("logs.slice(0, visibleCount)");
    expect(auditTable).toContain("count + pageSize");
  });

  it("los filtros de auditoría conservan la consulta existente y no añaden API", () => {
    expect(auditPage).toContain("prisma.auditLog.findMany");
    expect(auditPage).not.toContain("/api/admin/audit");
  });

  it("Dirección sigue sin recibir la sección Sistema del sidebar", () => {
    expect(adminNav).toMatch(/view === "tecnica"[\s\S]*aria-label="Sistema"/);
  });

  it("cambiar la vista no muta el rol ni llama la API de usuarios", () => {
    expect(viewSwitch).toContain("document.cookie");
    expect(viewSwitch).not.toContain("/api/admin/users");
    expect(viewSwitch).not.toMatch(/JSON\.stringify\([^)]*role/);
  });

  it("la identidad del shell se vuelve a consultar después de cambiar de ruta o cuenta", () => {
    expect(adminSession).toContain("const pathname = usePathname()");
    expect(adminSession).toContain("}, [pathname]);");
    expect(adminSession).toContain("setSession({ ...emptySession, ready: true })");
  });
});
