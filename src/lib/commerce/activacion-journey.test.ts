import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";
import { WHATSAPP_AUTOMATION_PLAN } from "@/lib/nurture/default-automations-whatsapp";
import { courseAccessEligibility, momentoAplicaAlCurso } from "./course-entitlement";

/**
 * Que pasa en el instante en que el pago queda verificado.
 *
 * El derecho ya se concedia bien, pero nadie arrancaba el journey: la persona
 * quedaba pagada y sin bienvenida. El reloj no lo salvaba, porque programa por
 * reglas vencidas y la bienvenida es inmediata: su momento ya habia pasado
 * cuando el reloj miraba.
 */
const raiz = join(process.cwd(), "src");
const compras = readFileSync(join(raiz, "lib/commerce/purchases.ts"), "utf8");
const motor = readFileSync(join(raiz, "lib/nurture/engine.ts"), "utf8");

describe("el pago verificado arranca el journey", () => {
  it("`refrescarPago` lo activa cuando, y solo cuando, el pago queda verificado", () => {
    const refrescar = compras.slice(compras.indexOf("export async function refrescarPago"));
    const cuerpo = refrescar.slice(0, refrescar.indexOf("async function activarJourney"));
    expect(cuerpo).toContain("await activarJourney(compra.enrollmentId)");
    // Dentro del `if (verificado)`: un pago pendiente no arranca nada.
    const bloqueVerificado = cuerpo.slice(cuerpo.indexOf("if (verificado) {"));
    expect(bloqueVerificado).toContain("activarJourney");
  });

  it("reutiliza el punto canónico en vez de reimplementar la programación", () => {
    expect(compras).toContain('import { marcarJourneyProgramado, scheduleEnrollmentAutomations, sendDueMessagesForEnrollment } from "@/lib/nurture/engine"');
    const activar = compras.slice(compras.indexOf("async function activarJourney"));
    expect(activar).toContain("await scheduleEnrollmentAutomations(enrollmentId)");
    // Sin lógica propia de calendario: no decide fechas ni claves.
    expect(activar.slice(0, activar.indexOf("} catch"))).not.toMatch(/scheduledAt|sequenceKey|stepKey|prisma\./);
    // Y la marca de "programado" se escribe solo después de que termine.
    const hastaElCatch = activar.slice(0, activar.indexOf("} catch"));
    expect(hastaElCatch.indexOf("scheduleEnrollmentAutomations") < hastaElCatch.indexOf("marcarJourneyProgramado")).toBe(true);
  });

  it("la bienvenida sale sin esperar al reloj", () => {
    // Se programa para "ahora": si no se despacha aquí, esperaría al siguiente
    // tick para salir, y una bienvenida que llega tarde ya no es bienvenida.
    const activar = compras.slice(compras.indexOf("async function activarJourney"));
    expect(activar).toContain("await sendDueMessagesForEnrollment(enrollmentId)");
    const orden = activar.indexOf("scheduleEnrollmentAutomations") < activar.indexOf("sendDueMessagesForEnrollment");
    expect(orden, "primero se programa y después se despacha").toBe(true);
  });

  it("un curso de pago sin pago verificado no programa nada", () => {
    expect(courseAccessEligibility({ isFree: false }, { status: "INSCRITO" }, [{ status: "PAYMENT_PENDING" }]).habilitado).toBe(false);
    expect(courseAccessEligibility({ isFree: false }, { status: "INSCRITO" }, []).habilitado).toBe(false);
  });
});

describe("el pago pesa más que el envío", () => {
  it("la activación queda FUERA de la transacción del pago", () => {
    const refrescar = compras.slice(compras.indexOf("export async function refrescarPago"));
    const transaccion = refrescar.slice(refrescar.indexOf("prisma.$transaction"), refrescar.indexOf("if (verificado) {"));
    expect(transaccion).not.toContain("activarJourney");
    expect(transaccion).not.toContain("scheduleEnrollmentAutomations");
  });

  it("si la mensajería falla, el pago sigue verificado y el error queda anotado", () => {
    // No se propaga: revertir un cobro porque el proveedor de mensajes esté
    // caído sería cambiar un problema pequeño por uno grave.
    const activar = compras.slice(compras.indexOf("async function activarJourney"));
    expect(activar).toContain("} catch (error: unknown) {");
    expect(activar).toContain("ENROLLMENT_JOURNEY_ACTIVATION_FAILED");
    expect(activar).not.toContain("throw");
    // El envío inmediato queda FUERA de ese try: que el proveedor falle no
    // vuelve incompleta una programación que sí terminó.
    expect(activar).toContain("await sendDueMessagesForEnrollment(enrollmentId).catch(() => undefined)");
  });

  it("la auditoría del fallo no arrastra datos del contacto ni del proveedor", () => {
    const activar = compras.slice(compras.indexOf("async function activarJourney"));
    const metadatos = activar.slice(activar.indexOf("metadata:"), activar.indexOf("}).catch"));
    expect(metadatos).toContain("slice(0, 200)");
    expect(metadatos).not.toMatch(/phone|email|nombre|token/i);
  });
});

describe("idempotencia", () => {
  it("verificar dos veces no duplica: la identidad no depende del pago", () => {
    // `scheduleEnrollmentAutomations` busca por la clave única de siempre y
    // actualiza el mensaje existente en lugar de crear otro.
    expect(motor).toMatch(/leadId_enrollmentId_sequenceKey_stepKey/);
    const claves = motor.slice(motor.indexOf("sequenceKey: `automation:"), motor.indexOf("stepKey: target.stepKey"));
    expect(claves).not.toMatch(/paid|purchase|payment|verificad/i);
  });

  it("el reloj repetido no duplica: la candidata es la que no tiene marca", () => {
    // "Tener mensajes" no servía: la programación hace un upsert por paso, así
    // que una que muriera a medias dejaba un mensaje suelto y quedaba excluida
    // para siempre. Lo que decide ahora es la marca de haber terminado.
    const reconcilia = motor.slice(motor.indexOf("export async function reconcileEntitledEnrollments"));
    expect(reconcilia).toContain("events: { none: { type: JOURNEY_SCHEDULED } }");
    expect(reconcilia).not.toContain("messages: { none: {} }");
  });

  it("la reconciliación reutiliza el mismo punto canónico", () => {
    const reconcilia = motor.slice(motor.indexOf("export async function reconcileEntitledEnrollments"));
    expect(reconcilia).toContain("scheduleEnrollmentAutomations(inscripcion.id, now)");
  });
});

describe("recuperación", () => {
  it("vive en el reloj que ya existe, no en un cron nuevo", () => {
    expect(motor).toContain("const reconciliadas = await reconcileEntitledEnrollments(now);");
    const despacho = motor.slice(motor.indexOf("export async function processScheduledMessages"));
    // Antes de despachar, para que los mensajes recuperados salgan en la misma vuelta.
    expect(despacho.indexOf("reconcileEntitledEnrollments") < despacho.indexOf("const pending = await prisma.outboundMessage.findMany")).toBe(true);
  });

  it("es estrecha: solo cursos de pago, solo con pago verificado, y acotada", () => {
    const reconcilia = motor.slice(motor.indexOf("export async function reconcileEntitledEnrollments"));
    expect(reconcilia).toContain("isFree: false");
    expect(reconcilia).toContain("isPublished: true");
    expect(reconcilia).toContain("purchases: { some: { status: ESTADO_PAGO_VERIFICADO } }");
    // Se descartan de entrada los candidatos que el programador rechazaria: no
    // cambia el resultado, evita revisarlos en cada vuelta del reloj.
    expect(reconcilia).toContain("automationsPausedAt: null");
    expect(reconcilia).toContain('automationRules: { some: { status: "ACTIVE" } }');
    expect(reconcilia).toContain('lead: { classification: "REAL", consent: true }');
    expect(reconcilia).toContain("take: RECONCILIACION_POR_VUELTA");
    expect(motor).toContain("const RECONCILIACION_POR_VUELTA = 10");
  });

  it("no toca cursos gratuitos ni inscripciones cerradas", () => {
    const reconcilia = motor.slice(motor.indexOf("export async function reconcileEntitledEnrollments"));
    expect(reconcilia).toContain('status: { in: ["INTERESADO", "INSCRITO", "EN_CURSO"] }');
    // `isFree: false` ya excluye los gratuitos de la consulta.
    expect(reconcilia).not.toContain("isFree: true");
  });

  it("deja rastro de lo que recupera", () => {
    const reconcilia = motor.slice(motor.indexOf("export async function reconcileEntitledEnrollments"));
    expect(reconcilia).toContain("ENROLLMENT_JOURNEY_RECONCILED");
  });
});

describe("lo que no cambia", () => {
  it("el taller gratuito sigue arrancando con el registro", () => {
    expect(courseAccessEligibility({ isFree: true }, { status: "INSCRITO" }, []).habilitado).toBe(true);
    expect(courseAccessEligibility({ isFree: true }, { status: "INTERESADO" }, []).habilitado).toBe(true);
  });

  it("el cierre y el seguimiento siguen fuera de los cursos de pago", () => {
    for (const planKey of ["course_complete", "course_follow_up"]) {
      expect(momentoAplicaAlCurso(planKey, { isFree: false }), planKey).toBe(false);
      expect(momentoAplicaAlCurso(planKey, { isFree: true }), planKey).toBe(true);
    }
  });

  it("los doce contratos de WhatsApp siguen intactos", () => {
    expect(Object.keys(WHATSAPP_TEMPLATES)).toHaveLength(12);
    expect(WHATSAPP_TEMPLATES.welcome.bodyVars).toHaveLength(6);
    expect(WHATSAPP_TEMPLATES.welcome.name).toBe("ra_training_bienvenida_inscripcion");
    expect(WHATSAPP_TEMPLATES.thank_you.name).toBe("ra_training_fin_sesion");
    expect(WHATSAPP_TEMPLATES.survey.name).toBe("ra_training_encuesta_experiencia");
    expect(WHATSAPP_AUTOMATION_PLAN).toHaveLength(11);
    expect(WHATSAPP_AUTOMATION_PLAN.map((e) => e.templateKey)).not.toContain("certification_offer");
  });

  it("no se toca Finance ni la facturación al activar", () => {
    const activar = compras.slice(compras.indexOf("async function activarJourney"), compras.indexOf("export async function crearUpgrade"));
    expect(activar).not.toMatch(/getCrmPurchaseStatus|\bfactura\b|\bSRI\b|\bIVA\b/);
  });
});
