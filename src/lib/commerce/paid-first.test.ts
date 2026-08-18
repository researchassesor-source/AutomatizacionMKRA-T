import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { courseAccessEligibility, momentoAplicaAlCurso, participantHasCourseEntitlement } from "./course-entitlement";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";
import { WHATSAPP_AUTOMATION_PLAN } from "@/lib/nurture/default-automations-whatsapp";

/**
 * Paid first: quien no ha pagado no entra al curso.
 *
 * El riesgo que cubre esta prueba es de una sola direccion. Bloquear de mas se
 * nota enseguida —alguien avisa de que no le llego el acceso— pero abrir de mas
 * no lo nota nadie: el curso se regala en silencio. Por eso todo lo que no sea
 * gratuito o pago verificado tiene que dar false.
 */
const PAGADO = { isFree: false };
const GRATUITO = { isFree: true };
const INSCRITO = { status: "INSCRITO" as const };

const raiz = join(process.cwd(), "src");
const motor = readFileSync(join(raiz, "lib/nurture/engine.ts"), "utf8");

/**
 * Codigo sin comentarios.
 *
 * Los comentarios de este modulo nombran a proposito lo que NO concede el
 * derecho —el importe, el comprobante, la factura de Finance—, asi que buscar
 * esas palabras en el archivo entero encontraria justo la explicacion de que no
 * se usan.
 */
function soloCodigo(ruta: string) {
  return readFileSync(join(raiz, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("derecho de acceso", () => {
  it("curso de pago sin ninguna compra: NO", () => {
    expect(participantHasCourseEntitlement(PAGADO, INSCRITO, [])).toBe(false);
    expect(courseAccessEligibility(PAGADO, INSCRITO, []).motivo).toBe("SIN_PAGO");
  });

  it("curso de pago con la compra registrada pero sin cobrar: NO", () => {
    // Registrar una compra y cobrarla son hechos distintos.
    for (const status of ["PENDING", "SENT_TO_FINANCE", "PAYMENT_PENDING"] as const) {
      expect(participantHasCourseEntitlement(PAGADO, INSCRITO, [{ status }]), status).toBe(false);
    }
  });

  it("curso de pago con el pago verificado: SÍ", () => {
    expect(participantHasCourseEntitlement(PAGADO, INSCRITO, [{ status: "PAYMENT_VERIFIED" }])).toBe(true);
    expect(courseAccessEligibility(PAGADO, INSCRITO, [{ status: "PAYMENT_VERIFIED" }]).motivo).toBe("PAGO_VERIFICADO");
  });

  it("taller gratuito con registro válido: SÍ, sin necesitar pago", () => {
    expect(participantHasCourseEntitlement(GRATUITO, INSCRITO, [])).toBe(true);
    expect(courseAccessEligibility(GRATUITO, INSCRITO, []).motivo).toBe("GRATUITO");
  });

  it("una compra cancelada o con error no concede nada", () => {
    for (const status of ["CANCELLED", "ERROR"] as const) {
      expect(participantHasCourseEntitlement(PAGADO, INSCRITO, [{ status }]), status).toBe(false);
    }
  });

  it("una verificada entre varias basta", () => {
    expect(participantHasCourseEntitlement(PAGADO, INSCRITO, [{ status: "CANCELLED" }, { status: "PAYMENT_VERIFIED" }])).toBe(true);
  });

  it("la inscripción cancelada no recibe nada, ni siquiera de un curso gratuito", () => {
    const cancelada = { status: "CANCELADO" as const };
    expect(participantHasCourseEntitlement(GRATUITO, cancelada, [])).toBe(false);
    expect(participantHasCourseEntitlement(PAGADO, cancelada, [{ status: "PAYMENT_VERIFIED" }])).toBe(false);
  });

  it("falla cerrado ante un estado de compra que nadie previó", () => {
    // Si mañana aparece un estado nuevo, la puerta sigue cerrada hasta que
    // alguien decida explicitamente que abre.
    expect(participantHasCourseEntitlement(PAGADO, INSCRITO, [{ status: "ESTADO_FUTURO" as never }])).toBe(false);
  });
});

describe("el importe no decide nada", () => {
  it("la gratuidad la declara el curso, no un precio en cero", () => {
    // `isFree` es la fuente explicita. Un curso de pago con precio 0 mal
    // cargado no puede convertirse en gratuito por accidente.
    const fuente = soloCodigo("lib/commerce/course-entitlement.ts");
    // La gratuidad se lee de la marca del curso, y no hay ninguna cifra de
    // dinero en la decisión. (`compras.length === 0` cuenta compras, no
    // importes, así que se comprueban los nombres de los campos monetarios.)
    expect(fuente).toContain("curso.isFree");
    expect(fuente).not.toMatch(/\bprice\b|\bamount\b|\bmonto\b|\btotal\b|\bvalor\b/i);
  });

  it("el derecho no mira importes: 10 o 20 dólares no seleccionan modalidad", () => {
    // La modalidad (institucional / aval externo) la gobierna `offerType`, que
    // este archivo no toca. Aqui solo se comprueba que no aparezca ninguna
    // decision por cantidad.
    const fuente = soloCodigo("lib/commerce/course-entitlement.ts");
    expect(fuente).not.toContain("INSTITUTIONAL");
    expect(fuente).not.toContain("AVAL_UPGRADE");
  });

  it("la clasificación comercial sigue viviendo donde ya vivía", () => {
    const entitlement = readFileSync(join(raiz, "lib/commerce/entitlement.ts"), "utf8");
    expect(entitlement).toContain('compra.offerType === "FULL"');
    expect(entitlement).toContain('compra.offerType === "INSTITUTIONAL"');
  });
});

describe("arranque del journey", () => {
  it("el programador comprueba el derecho ANTES de crear ningún mensaje", () => {
    const inicio = motor.slice(motor.indexOf("export async function scheduleEnrollmentAutomations"));
    const antesDeProgramar = inicio.slice(0, inicio.indexOf("const sessions = resolveCourseSessions"));
    expect(antesDeProgramar).toContain("courseAccessEligibility(enrollment.course, enrollment, enrollment.purchases)");
    expect(antesDeProgramar).toContain('reason: "COURSE_NOT_ENTITLED"');
  });

  it("el despachador vuelve a comprobarlo antes de enviar, y falla cerrado", () => {
    // Un mensaje puede haberse programado antes, o el pago haberse cancelado
    // despues: la segunda puerta es la que impide que salga igualmente.
    const envio = motor.slice(motor.indexOf("export async function sendMessage"));
    expect(envio).toContain("courseAccessEligibility(message.enrollment.course, message.enrollment, message.enrollment.purchases)");
    expect(envio).toMatch(/status: "OMITIDO", errorCode: "COURSE_NOT_ENTITLED"/);
  });

  it("la comprobación vive en un solo sitio: nadie reimplementa la regla", () => {
    // Buscar el estado verificado suelto por el codigo seria la forma de que
    // dos sitios acabaran discrepando.
    const propio = readFileSync(join(raiz, "lib/commerce/course-entitlement.ts"), "utf8");
    expect(propio).toContain('CoursePurchaseStatus = "PAYMENT_VERIFIED"');
    expect(motor).not.toContain("PAYMENT_VERIFIED");
  });

  it("no duplica: la identidad del mensaje no depende de cuándo se pagó", () => {
    // Verificar el pago dos veces, o que el reloj corra diez veces, vuelve a
    // llamar al programador; la clave idempotente es la misma y el mensaje ya
    // existente se actualiza en lugar de crearse otro.
    expect(motor).toMatch(/leadId_enrollmentId_sequenceKey_stepKey/);
    expect(motor).toMatch(/sequenceKey: `automation:\$\{rule\.channel\}:\$\{rule\.planKey \?\? rule\.id\}`/);
    const claves = motor.slice(motor.indexOf("sequenceKey: `automation:"), motor.indexOf("stepKey: target.stepKey"));
    expect(claves).not.toMatch(/paid|purchase|payment|acceso/i);
  });

  it("un taller gratuito no pasa por ninguna puerta nueva", () => {
    expect(courseAccessEligibility(GRATUITO, INSCRITO, []).habilitado).toBe(true);
    expect(courseAccessEligibility(GRATUITO, { status: "INTERESADO" }, []).habilitado).toBe(true);
  });
});

describe("mensajes del embudo gratuito", () => {
  it("el cierre y el seguimiento no se programan en un curso de pago", () => {
    // Sus textos dicen "esta capacitación gratuita" y ofrecen la version
    // completa: a quien acaba de pagar le dirian que lo suyo era gratis.
    for (const planKey of ["course_complete", "course_follow_up"]) {
      expect(momentoAplicaAlCurso(planKey, PAGADO), planKey).toBe(false);
      expect(momentoAplicaAlCurso(planKey, GRATUITO), planKey).toBe(true);
    }
  });

  it("el resto del journey sí aplica a los dos", () => {
    for (const planKey of ["welcome", "whatsapp_group", "reminder_24h", "reminder_2h", "reminder_15m", "session_live", "late_access", "thank_you", "survey"]) {
      expect(momentoAplicaAlCurso(planKey, PAGADO), planKey).toBe(true);
    }
  });

  it("el motor aplica ese filtro al programar", () => {
    expect(motor).toContain("momentoAplicaAlCurso(rule.planKey, enrollment.course)");
  });

  it("los textos que se excluyen son efectivamente los del embudo gratuito", () => {
    // Si mañana alguien reescribe estos textos y dejan de hablar de gratuidad,
    // esta prueba falla y obliga a revisar la exclusión en vez de arrastrarla.
    expect(WHATSAPP_TEMPLATES.course_complete.sample).toContain("capacitación gratuita");
    expect(WHATSAPP_TEMPLATES.course_follow_up.sample).toContain("capacitación gratuita");
  });
});

describe("lo que este bloque no toca", () => {
  it("la oferta institucional sigue fuera del journey", () => {
    expect(WHATSAPP_AUTOMATION_PLAN.map((e) => e.templateKey)).not.toContain("certification_offer");
    expect(Object.keys(WHATSAPP_TEMPLATES)).toContain("certification_offer");
  });

  it("los contratos de las plantillas no cambian", () => {
    expect(WHATSAPP_TEMPLATES.welcome.bodyVars).toHaveLength(6);
    expect(WHATSAPP_TEMPLATES.welcome.name).toBe("ra_training_bienvenida_inscripcion");
    expect(WHATSAPP_TEMPLATES.thank_you.name).toBe("ra_training_fin_sesion");
    expect(WHATSAPP_TEMPLATES.survey.name).toBe("ra_training_encuesta_experiencia");
    expect(Object.keys(WHATSAPP_TEMPLATES)).toHaveLength(12);
  });

  it("el journey sigue siendo los mismos once momentos, con los mismos tiempos", () => {
    expect(WHATSAPP_AUTOMATION_PLAN).toHaveLength(11);
    const tiempos = Object.fromEntries(WHATSAPP_AUTOMATION_PLAN.map((e) => [e.planKey, e.offsetMinutes]));
    expect(tiempos.reminder_24h).toBe(24 * 60);
    expect(tiempos.reminder_2h).toBe(120);
    expect(tiempos.reminder_15m).toBe(15);
    expect(tiempos.thank_you).toBe(5);
  });

  it("el cierre de sesión sigue saliendo solo cuando hay una siguiente", () => {
    expect(motor).toContain("if (esCierre && !nextSessionAfter(session, sessions)) return [];");
  });

  it("no se toca Finance ni la facturación", () => {
    const propio = soloCodigo("lib/commerce/course-entitlement.ts");
    expect(propio).not.toMatch(/finance|Finance|SRI|factura|IVA/i);
  });
});

describe("la interfaz muestra el acceso sin decidirlo", () => {
  const panel = readFileSync(join(raiz, "app/admin/leads/[id]/LeadDetailManager.tsx"), "utf8");
  const pagina = readFileSync(join(raiz, "app/admin/leads/[id]/page.tsx"), "utf8");

  it("hay una columna de acceso junto al estado comercial", () => {
    expect(panel).toContain("<th>Acceso al curso</th>");
    expect(panel).toContain("item.acceso.etiqueta");
  });

  it("la etiqueta se deriva de la función central, no se recalcula en pantalla", () => {
    expect(pagina).toContain("courseAccessEligibility(item.course, item, item.purchases)");
    expect(panel).not.toContain("PAYMENT_VERIFIED");
  });

  it("cada motivo tiene su texto, sin códigos técnicos sueltos", () => {
    expect(courseAccessEligibility(PAGADO, INSCRITO, []).etiqueta).toBe("Pendiente de pago");
    expect(courseAccessEligibility(GRATUITO, INSCRITO, []).etiqueta).toBe("Gratuito · habilitado");
    expect(courseAccessEligibility(PAGADO, INSCRITO, [{ status: "PAYMENT_VERIFIED" }]).etiqueta).toBe("Habilitado");
  });
});
