import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORIAS, MAX_EVENTOS } from "./lead-timeline";

/**
 * Actividad del contacto.
 *
 * Se lee de las tablas reales. Lo que se protege aqui es que no aparezca en la
 * ficha nada que no deba —respuestas del proveedor, tokens, objetos de
 * Finance— y que el importe nunca se presente como si explicara la modalidad
 * comprada, porque esa confusion es justo la que el modelo comercial evita.
 */
const raiz = join(process.cwd(), "src");
const agregador = readFileSync(join(raiz, "lib/timeline/lead-timeline.ts"), "utf8");
const endpoint = readFileSync(join(raiz, "app/api/admin/leads/[id]/timeline/route.ts"), "utf8");
const ui = readFileSync(join(raiz, "app/admin/leads/[id]/LeadTimeline.tsx"), "utf8");
const ficha = readFileSync(join(raiz, "app/admin/leads/[id]/page.tsx"), "utf8");

describe("fuentes", () => {
  it("cubre registro, inscripción, compra, pago, mensajes, handoff y oferta", () => {
    for (const tipo of [
      "LEAD_CREATED", "ENROLLMENT_CREATED", "ENTITLEMENT_GRANTED", "PURCHASE_CREATED",
      "PAYMENT_VERIFIED", "HUMAN_REPLY", "AUTOMATION_MESSAGE", "INBOUND_MESSAGE",
      "HANDOFF_STARTED", "HANDOFF_RESOLVED", "OFFER_SENT", "OFFER_PREPARED", "JOURNEY_SCHEDULED",
    ]) {
      expect(agregador, tipo).toContain(tipo);
    }
  });

  it("no crea una tabla de historial: lee de las que ya existen", () => {
    // Copiar cada hecho obligaria a mantener dos verdades, y en cuanto una
    // escritura fallara la copia mentiria sobre lo que paso.
    for (const modelo of ["prisma.enrollment", "prisma.coursePurchase", "prisma.outboundMessage", "prisma.inboundMessage", "prisma.conversation", "prisma.certificationOfferRecipient"]) {
      expect(agregador).toContain(`${modelo}.findMany`);
    }
    expect(agregador).not.toContain("prisma.timeline");
  });

  it("lo que ocurre en el Inbox aparece sin duplicar nada", () => {
    // El entrante, la respuesta humana y el handoff salen de sus tablas reales,
    // no de un registro paralelo creado para "sincronizar".
    expect(agregador).toContain("prisma.inboundMessage.findMany");
    expect(agregador).toContain('m.origin === "HUMAN"');
    expect(agregador).toContain("c.handoffAt");
  });

  it("filtra el ruido técnico de los eventos", () => {
    expect(agregador).toContain('if (e.type !== "ENROLLMENT_JOURNEY_SCHEDULED") continue;');
  });
});

describe("comercio", () => {
  it("la modalidad la dice offerType, nunca el importe", () => {
    expect(agregador).toContain("MODALIDAD[c.offerType]");
    // El importe se muestra como dato, con esa palabra exacta.
    expect(agregador).toContain("Importe registrado");
    expect(agregador).not.toMatch(/amount === 10|amount === 20|amount >/);
  });

  it("las tres modalidades tienen nombre legible", () => {
    for (const clave of ["FULL", "INSTITUTIONAL", "AVAL_UPGRADE"]) {
      expect(agregador).toContain(`${clave}:`);
    }
  });

  it("distingue campaña histórica de automática", () => {
    expect(agregador).toContain("HISTORICAL_MANUAL");
    expect(agregador).toContain("Campaña automática");
  });
});

describe("privacidad", () => {
  it("no expone respuestas del proveedor ni secretos", () => {
    for (const fuente of [agregador, endpoint, ui]) {
      expect(fuente).not.toMatch(/providerResponse|accessToken|appSecret|verifyToken|Bearer/);
    }
  });

  it("no arrastra objetos completos: cada consulta hace select", () => {
    const consultas = agregador.split("findMany").slice(1);
    for (const consulta of consultas) expect(consulta.slice(0, 400)).toContain("select:");
  });

  it("los textos largos se recortan", () => {
    expect(agregador).toContain("function recorte");
    expect(agregador).toContain("largo = 140");
  });
});

describe("paginación y límites", () => {
  it("hay un tope duro y ninguna consulta va suelta", () => {
    expect(MAX_EVENTOS).toBeLessThanOrEqual(60);
    const consultas = agregador.split("findMany").slice(1);
    for (const consulta of consultas) expect(consulta.slice(0, 500)).toContain("take:");
  });

  it("el endpoint valida los parámetros y limita", () => {
    expect(endpoint).toContain("z.coerce.number().int().min(1).max(MAX_EVENTOS)");
    expect(endpoint).toContain("schema.safeParse");
  });

  it("se pagina hacia atrás por fecha, no por desplazamiento", () => {
    expect(agregador).toContain("nextBefore");
    expect(endpoint).toContain("before");
  });

  it("el orden por defecto es lo más reciente primero", () => {
    expect(agregador).toContain("b.timestamp.localeCompare(a.timestamp)");
  });
});

describe("acceso", () => {
  it("el endpoint exige sesión con rol", () => {
    expect(endpoint).toContain("requireRole(request, OPERACION)");
  });

  it("un contacto inexistente responde 404, no una lista vacía", () => {
    expect(endpoint).toContain("status: 404");
  });

  it("el identificador viene de la ruta: no se puede pedir el de otro", () => {
    expect(endpoint).toContain("const { id } = await params;");
    expect(endpoint).toContain("construirTimeline(id,");
  });
});

describe("interfaz", () => {
  it("se añade a la ficha sin sustituir lo que ya había", () => {
    expect(ficha).toContain("<LeadTimeline leadId={lead.id} />");
    expect(ficha).toContain("<LeadDetailManager");
  });

  it("ofrece los cinco filtros", () => {
    expect(CATEGORIAS.map((c) => c.key)).toEqual(["ALL", "MESSAGES", "COMMERCE", "AUTOMATION", "SYSTEM"]);
    expect(ui).toContain("CATEGORIAS.map");
  });

  it("cubre carga, error y vacío", () => {
    expect(ui).toContain("Cargando actividad…");
    expect(ui).toContain("No se pudo cargar la actividad.");
    expect(ui).toContain("Aún no hay actividad para este filtro.");
  });

  it("no interpreta HTML ni recalcula nada del backend", () => {
    expect(ui).not.toContain("dangerouslySetInnerHTML");
    expect(ui).not.toContain("PAYMENT_VERIFIED");
  });

  it("carga más actividad bajo demanda", () => {
    expect(ui).toContain("Ver actividad anterior");
    expect(ui).toContain("cargar(siguiente)");
  });
});

describe("selector de asesor", () => {
  const usuarios = readFileSync(join(raiz, "app/api/admin/users/assignable/route.ts"), "utf8");
  const inbox = readFileSync(join(raiz, "app/admin/mensajes/inbox/WhatsAppInbox.tsx"), "utf8");

  it("solo devuelve usuarios activos y con rol que pueda atender", () => {
    expect(usuarios).toContain("isActive: true");
    expect(usuarios).toContain("ROLES_ASIGNABLES");
  });

  it("devuelve lo mínimo: ni correo ni nada de la cuenta", () => {
    expect(usuarios).toContain("select: { id: true, name: true, role: true }");
    expect(usuarios).not.toMatch(/passwordHash|email/);
  });

  it("exige sesión y acota el resultado", () => {
    expect(usuarios).toContain("requireRole(request, OPERACION)");
    expect(usuarios).toContain("take: 100");
  });

  it("el Inbox muestra el desplegable y guarda por el PATCH existente", () => {
    expect(inbox).toContain('id="inbox-asesor"');
    expect(inbox).toContain("Sin asignar");
    expect(inbox).toContain('actualizarConversacion({ assignedToId: valor || null }');
  });

  it("la lista de asesores se pide una vez, no por conversación", () => {
    expect(inbox).toContain('fetch("/api/admin/users/assignable")');
    // Comparte efecto con la carga de cursos (para "Contacto nuevo" del panel
    // de vinculación), así que la ventana es algo más ancha que un solo fetch.
    const efecto = inbox.slice(inbox.indexOf('fetch("/api/admin/users/assignable")'));
    expect(efecto.slice(0, 700)).toContain("}, []);");
  });

  it("bloquea el control mientras guarda", () => {
    expect(inbox).toContain("disabled={asignando}");
    expect(inbox).toContain("Guardando…");
  });
});
