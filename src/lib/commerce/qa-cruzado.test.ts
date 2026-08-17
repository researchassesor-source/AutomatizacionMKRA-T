import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { esPagoVerificado, ESTADOS_DE_PAGO } from "./purchases";
import { resolverDerecho, type CompraMinima } from "./entitlement";
import { decidirAutomatico, decidirManual, OFFER_STEP_KEY, offerSequenceKey } from "./offer-eligibility";
import { COMMERCIAL_STATES, ENTITLEMENTS, MAX_COMMERCE_BATCH, OFFER_TYPES } from "@/lib/finance/commerce";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";

/**
 * QA cruzado CRM ↔ Finance.
 *
 * Fija el contrato tal como Finance lo cerro. Ninguna llamada real: lo que se
 * comprueba es que los nombres, los enums y las decisiones del CRM coinciden
 * con lo acordado, y que los once casos de negocio dan el resultado esperado.
 */
const raiz = join(process.cwd(), "src");
const cliente = readFileSync(join(raiz, "lib/finance/client.ts"), "utf8");
const comercio = readFileSync(join(raiz, "lib/finance/commerce.ts"), "utf8");
const compras = readFileSync(join(raiz, "lib/commerce/purchases.ts"), "utf8");
const campana = readFileSync(join(raiz, "lib/commerce/offer-campaign.ts"), "utf8");
const esquema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

const compra = (p: Partial<CompraMinima> & Pick<CompraMinima, "offerType">): CompraMinima => ({ status: "PENDING", ...p });

describe("contrato: autenticación y transporte", () => {
  it("envía serviceToken con el valor de CRM_SERVICE_TOKEN", () => {
    // Las acciones de CRMCompras lo exigen; el traspaso heredado sigue usando
    // su `token` de sesion, y por eso se mandan los dos.
    expect(cliente).toContain("process.env.CRM_SERVICE_TOKEN");
    expect(cliente).toContain("body.serviceToken = serviceToken");
    expect(cliente).toContain("body.token = token");
  });

  it("tiene plazo máximo y no cuelga el cron", () => {
    expect(cliente).toContain("AbortSignal.timeout(FINANCE_TIMEOUT_MS)");
  });

  it("no registra el token en ningún sitio", () => {
    expect(cliente).not.toMatch(/console\.(log|info|warn|error)[\s\S]{0,120}(token|serviceToken)/);
    expect(comercio).not.toMatch(/console\./);
  });
});

describe("contrato: acciones y enums", () => {
  it("usa los seis nombres de acción exactos", () => {
    for (const accion of [
      "importCrmPurchase", "getCrmPurchaseStatus", "getCrmPurchaseStatuses",
      "getCrmEnrollmentCommerceState", "getCrmEnrollmentCommerceStates", "markCrmCourseCompleted",
    ]) {
      expect(comercio, accion).toContain(`"${accion}"`);
    }
  });

  it("los nueve estados comerciales coinciden literalmente", () => {
    expect([...COMMERCIAL_STATES]).toEqual([
      "NO_PURCHASE", "FULL_PENDING", "FULL_VERIFIED", "INSTITUTIONAL_PENDING",
      "INSTITUTIONAL_VERIFIED", "UPGRADE_PENDING", "FULL_UPGRADED", "CANCELLED", "LEGACY_UNCLASSIFIED",
    ]);
  });

  it("los tres derechos y las tres modalidades coinciden", () => {
    expect([...ENTITLEMENTS]).toEqual(["NONE", "INSTITUTIONAL", "FULL"]);
    expect([...OFFER_TYPES]).toEqual(["FULL", "INSTITUTIONAL", "AVAL_UPGRADE"]);
  });

  it("el enum de Prisma coincide con el del contrato", () => {
    for (const estado of COMMERCIAL_STATES) {
      // Delimitadores de espacio en blanco: el esquema se guarda con CRLF y un
      // `\n` literal al final no casaria con `NOMBRE\r\n`.
      expect(esquema, estado).toMatch(new RegExp(`\\s${estado}\\s`));
    }
  });

  it("respeta el tope de 100 por lote", () => {
    expect(MAX_COMMERCE_BATCH).toBe(100);
    expect(comercio).toMatch(/crmEnrollmentIds\.length > MAX_COMMERCE_BATCH/);
    expect(comercio).toMatch(/crmOrderIds\.length > MAX_COMMERCE_BATCH/);
  });

  it("markCrmCourseCompleted envía completado y MOODLE", () => {
    const handoff = readFileSync(join(raiz, "lib/finance/handoff.ts"), "utf8");
    expect(handoff).toMatch(/completionStatus: "completado"/);
    expect(handoff).toMatch(/source/);
  });
});

describe("contrato: estados de pago", () => {
  it("conoce los cuatro del contrato", () => {
    expect([...ESTADOS_DE_PAGO]).toEqual(["PAYMENT_PENDING", "PAYMENT_REPORTED", "PAYMENT_VERIFIED", "PAYMENT_CANCELLED"]);
  });

  it("SOLO PAYMENT_VERIFIED confirma el pago", () => {
    expect(esPagoVerificado("PAYMENT_VERIFIED")).toBe(true);
    for (const estado of ["PAYMENT_PENDING", "PAYMENT_REPORTED", "PAYMENT_CANCELLED"]) {
      expect(esPagoVerificado(estado), estado).toBe(false);
    }
  });

  it("no acepta sinónimos ajenos al contrato", () => {
    // Aceptar "VERIFICADO" o "VERIFIED" habria concedido acceso ante un valor
    // que Finance nunca usa para decir que el pago esta hecho.
    for (const invento of ["VERIFICADO", "PAGADO", "VERIFIED", "OK", ""]) {
      expect(esPagoVerificado(invento), invento).toBe(false);
    }
    expect(esPagoVerificado(null)).toBe(false);
  });

  it("registrar la compra no la marca como pagada", () => {
    expect(compras).toMatch(/status: "SENT_TO_FINANCE"/);
  });
});

describe("los once casos cruzados", () => {
  it("A · sin compra → elegible para la oferta automática", () => {
    expect(resolverDerecho([])).toEqual({ tier: "NONE", accesoCursoCompleto: false });
    expect(decidirAutomatico({}, "NO_PURCHASE")).toMatchObject({ elegible: true, estado: "ELIGIBLE" });
  });

  it("B · FULL con pago pendiente → sin acceso y sin oferta", () => {
    expect(resolverDerecho([compra({ offerType: "FULL", status: "PAYMENT_PENDING" })]).accesoCursoCompleto).toBe(false);
    expect(decidirAutomatico({}, "FULL_PENDING")).toMatchObject({ elegible: false, estado: "NOT_ELIGIBLE_PENDING_PAYMENT" });
  });

  it("C · FULL verificada → tier FULL, acceso y oferta bloqueada", () => {
    expect(resolverDerecho([compra({ offerType: "FULL", status: "PAYMENT_VERIFIED" })]))
      .toEqual({ tier: "FULL", accesoCursoCompleto: true });
    expect(decidirAutomatico({}, "FULL_VERIFIED")).toMatchObject({ elegible: false, estado: "NOT_ELIGIBLE_PURCHASED" });
  });

  it("D · INSTITUTIONAL verificada → tier INSTITUTIONAL con acceso", () => {
    expect(resolverDerecho([compra({ offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" })]))
      .toEqual({ tier: "INSTITUTIONAL", accesoCursoCompleto: true });
  });

  it("E · institucional verificada + mejora pendiente → sigue INSTITUTIONAL", () => {
    const derecho = resolverDerecho([
      compra({ id: "p1", offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" }),
      compra({ id: "p2", offerType: "AVAL_UPGRADE", status: "PAYMENT_PENDING", parentPurchaseId: "p1" }),
    ]);
    expect(derecho).toEqual({ tier: "INSTITUTIONAL", accesoCursoCompleto: true });
  });

  it("F · institucional + mejora verificadas → FULL sin duplicar acceso", () => {
    const derecho = resolverDerecho([
      compra({ id: "p1", offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" }),
      compra({ id: "p2", offerType: "AVAL_UPGRADE", status: "PAYMENT_VERIFIED", parentPurchaseId: "p1" }),
    ]);
    expect(derecho).toEqual({ tier: "FULL", accesoCursoCompleto: true });
  });

  it("G · legacy sin clasificar + histórico → se puede seleccionar a mano", () => {
    expect(decidirManual({}, "HISTORICAL_MANUAL", "LEGACY_UNCLASSIFIED").elegible).toBe(true);
  });

  it("H · legacy sin clasificar + automático → nunca automático", () => {
    expect(decidirAutomatico({}, "LEGACY_UNCLASSIFIED")).toMatchObject({ elegible: false, estado: "REQUIRES_REVIEW" });
  });

  it("I · enviado a mano → el cron posterior no crea un segundo mensaje", () => {
    expect(decidirAutomatico({ manualSentAt: new Date() }, "NO_PURCHASE")).toMatchObject({ elegible: false, estado: "SENT" });
    // Ademas la consulta del cron ya los excluye antes de decidir.
    expect(campana).toMatch(/manualSentAt: null,\s*automaticSentAt: null/);
  });

  it("J · compra entre la pantalla y el envío → la reconsulta lo bloquea", () => {
    // Se consulta Finance justo antes de escribir, no al cargar la lista.
    expect(campana).toMatch(/consultarFinance\(destinatarios\.map/);
    expect(decidirAutomatico({}, "FULL_VERIFIED").elegible).toBe(false);
  });

  it("K · Finance caído tras completar → lo local no se revierte", () => {
    const handoff = readFileSync(join(raiz, "lib/finance/handoff.ts"), "utf8");
    // Dentro de completeEnrollment el aviso va DESPUES de marcar COMPLETADO,
    // y su fallo solo deja constancia: nada revierte el estado local.
    const completar = handoff.slice(handoff.indexOf("export async function completeEnrollment"));
    expect(completar.indexOf("markCrmCourseCompleted")).toBeGreaterThan(completar.indexOf('action: "COURSE_COMPLETED"'));
    expect(completar).toContain("COURSE_COMPLETION_FINANCE_PENDING");
    // Ningun camino vuelve a escribir el estado de la inscripcion tras el aviso.
    expect(completar.slice(completar.indexOf("markCrmCourseCompleted"))).not.toMatch(/enrollment\.update|status: "EN_CURSO"/);
  });
});

describe("identidad del mensaje: manual y automático son el mismo", () => {
  it("la restricción de OutboundMessage es la esperada", () => {
    expect(esquema).toMatch(/@@unique\(\[leadId, enrollmentId, sequenceKey, stepKey\]\)/);
  });

  it("los cuatro campos se calculan una sola vez, sin depender del origen", () => {
    // El origen solo elige que marca de tiempo se guarda en el destinatario;
    // no aparece en ninguno de los cuatro campos de la clave.
    const inicio = campana.indexOf("prisma.outboundMessage.create");
    const creacion = campana.slice(inicio, campana.indexOf("});", campana.indexOf("waTemplate:", inicio)));
    expect(creacion).toContain("leadId: destinatario.enrollment.leadId");
    expect(creacion).toContain("enrollmentId: destinatario.enrollmentId");
    expect(creacion).toContain("sequenceKey: secuencia");
    expect(creacion).toContain("stepKey: OFFER_STEP_KEY");
    expect(creacion).not.toMatch(/contexto\.origen/);
  });

  it("la clave depende del curso y del paso, de nada más", () => {
    expect(offerSequenceKey("c1")).toBe("certification-offer:c1");
    expect(OFFER_STEP_KEY).toBe("institutional-offer");
  });
});

describe("plantilla de Meta", () => {
  it("nombre, idioma y orden de variables", () => {
    const plantilla = WHATSAPP_TEMPLATES.certification_offer;
    expect(plantilla.name).toBe("ra_training_certificacion_institucional");
    // Idioma real usado por las otras once, no supuesto.
    expect(plantilla.language).toBe("es");
    expect(plantilla.bodyVars).toEqual(["nombre", "curso", "link_oferta_institucional"]);
  });

  it("todas las plantillas comparten el mismo código de idioma", () => {
    const idiomas = new Set(Object.values(WHATSAPP_TEMPLATES).map((p) => p.language));
    expect([...idiomas]).toEqual(["es"]);
  });

  it("la campaña rellena esas tres variables en ese orden", () => {
    const bloque = campana.slice(campana.indexOf("const variables = {"));
    expect(bloque).toMatch(/nombre:[\s\S]{0,200}curso: campana\.course\.title,\s*link_oferta_institucional: urlOferta,/);
  });
});

describe("los once mensajes no cambiaron", () => {
  it("sus once plantillas siguen registradas con el mismo nombre", () => {
    const nombres = Object.entries(WHATSAPP_TEMPLATES)
      .filter(([clave]) => clave !== "certification_offer")
      .map(([, spec]) => spec.name)
      .sort();
    expect(nombres).toEqual([
      "ra_training_acceso_15min", "ra_training_acceso_2h", "ra_training_acceso_rezagados",
      "ra_training_agradecimiento_final", "ra_training_bienvenida_inscripcion", "ra_training_curso_completo",
      "ra_training_encuesta", "ra_training_grupo_whatsapp", "ra_training_recordatorio_24h",
      "ra_training_seguimiento_curso", "ra_training_sesion_en_vivo",
    ]);
  });

  it("la campaña no toca el plan ni las reglas de automatización", () => {
    expect(campana).not.toMatch(/automationRule|DEFAULT_AUTOMATION_PLAN|WHATSAPP_AUTOMATION_PLAN|planKey/);
  });

  it("el cierre de cursos no conoce la campaña de la oferta", () => {
    const motor = readFileSync(join(raiz, "lib/nurture/engine.ts"), "utf8");
    expect(motor).not.toContain("certification-offer");
    expect(motor).not.toContain("CertificationOffer");
  });
});
