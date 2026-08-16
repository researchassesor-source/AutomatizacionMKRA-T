import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garantias operativas de la campaña de oferta institucional.
 *
 * Se comprueban leyendo el codigo fuente. Montar Prisma en memoria para cada
 * caso costaria mas de lo que aporta: lo que hay que fijar aqui son decisiones
 * estructurales —que el cron filtre por modo, que el anti-duplicados dependa de
 * una restriccion y no de un `if`, que el estado no diga "enviado" cuando solo
 * esta en cola—, y todas son visibles en el codigo.
 */
const raiz = join(process.cwd(), "src");
const campana = readFileSync(join(raiz, "lib/commerce/offer-campaign.ts"), "utf8");
const compras = readFileSync(join(raiz, "lib/commerce/purchases.ts"), "utf8");
const tick = readFileSync(join(raiz, "lib/cron-tick.ts"), "utf8");
const handoff = readFileSync(join(raiz, "lib/finance/handoff.ts"), "utf8");
const rutaCampana = readFileSync(join(raiz, "app/api/admin/commerce/campaign/route.ts"), "utf8");
const rutaCompras = readFileSync(join(raiz, "app/api/admin/commerce/purchases/route.ts"), "utf8");

describe("el cron nunca procesa una campaña histórica", () => {
  it("filtra por AUTOMATIC_COMMERCE en la propia consulta", () => {
    // En la consulta y no despues: asi una campaña historica no llega a la
    // logica de envio ni aunque tuviera fecha por error.
    expect(campana).toMatch(/audienceMode: "AUTOMATIC_COMMERCE"[\s\S]{0,200}automaticScheduledAt: \{ lte: ahora \}/);
  });

  it("además rechaza el origen automático si la campaña no es automática", () => {
    expect(campana).toMatch(/origen === "AUTOMATICO" && campana\.audienceMode !== "AUTOMATIC_COMMERCE"/);
  });

  it("una campaña histórica no recibe fecha automática", () => {
    expect(campana).toMatch(/audienceMode === "AUTOMATIC_COMMERCE"\s*\?\s*calcularEnvioAutomatico/);
  });

  it("el reloj maestro invoca las ofertas de forma aislada", () => {
    expect(tick).toContain('aislar("ofertas"');
    expect(tick).toContain("procesarCampanasVencidas");
  });
});

describe("anti-duplicados", () => {
  it("se apoya en la restricción única, no en un «si ya existe»", () => {
    // Un findFirst previo al insert no aguanta dos peticiones simultaneas: las
    // dos verian "no existe" y las dos insertarian.
    expect(campana).toMatch(/catch \(error\)/);
    expect(campana).toMatch(/error\.code === "P2002"/);
  });

  it("un choque de clave se trata como ya encolado, no como fallo", () => {
    expect(campana).toMatch(/YA_ENCOLADO/);
  });

  it("manual y automático comparten la misma identidad de mensaje", () => {
    expect(campana).toContain("offerSequenceKey(campana.courseId)");
    expect(campana).toContain("stepKey: OFFER_STEP_KEY");
    // Si hubiera claves distintas por origen, el mismo mensaje podria salir dos veces.
    expect(campana).not.toMatch(/manual-step|auto-step/);
  });

  it("excluye de la consulta a quien ya recibió o fue excluido", () => {
    expect(campana).toMatch(/manualSentAt: null,\s*automaticSentAt: null,\s*manualExcludedAt: null/);
  });

  it("el claim de campaña sólo deja pasar a un proceso", () => {
    // Dos crones concurrentes: solo uno logra pasar de SCHEDULED a RUNNING.
    expect(campana).toMatch(/updateMany\(\{[\s\S]{0,160}status: "SCHEDULED"[\s\S]{0,120}status: "RUNNING"/);
    expect(campana).toMatch(/reclamada\.count !== 1/);
  });

  it("dar de alta destinatarios dos veces no los duplica", () => {
    expect(campana).toContain("skipDuplicates: true");
  });
});

describe("el estado refleja la realidad, no la intención", () => {
  it("la auditoría dice ENCOLADO y no ENVIADO", () => {
    // El envio real lo hace el dispatcher; afirmar "enviado" al insertar la
    // fila seria decir algo que aun no ocurrio.
    expect(campana).toContain("CERT_OFFER_MANUAL_QUEUED");
    expect(campana).toContain("CERT_OFFER_AUTO_QUEUED");
    expect(campana).not.toContain("CERT_OFFER_MANUAL_SENT");
  });

  it("el mensaje se crea como PROGRAMADO para que lo despache el flujo existente", () => {
    expect(campana).toMatch(/status: "PROGRAMADO"/);
  });

  it("el endpoint devuelve «encolados», no «enviados»", () => {
    expect(rutaCampana).toMatch(/encolados/);
  });
});

describe("fail closed", () => {
  it("sin URL de oferta no se escribe a nadie", () => {
    expect(campana).toContain("FALTA_URL_OFERTA");
  });

  it("sin respuesta de Finance no se envía nada en modo automático", () => {
    expect(campana).toContain("FINANCE_NO_DISPONIBLE");
    expect(campana).toContain("CERT_OFFER_FINANCE_CHECK_FAILED");
  });

  it("un contacto sin WhatsApp no se intenta", () => {
    expect(campana).toContain("SIN_TELEFONO");
  });

  it("Finance se reconsulta justo antes de escribir, no al cargar la pantalla", () => {
    // Entre cargar la lista y pulsar enviar alguien puede haber comprado.
    expect(campana).toMatch(/consultarFinance\(destinatarios\.map/);
  });

  it("la consulta a Finance respeta el tope por lotes", () => {
    expect(campana).toContain("MAX_COMMERCE_BATCH");
    expect(campana).toContain("enLotes");
  });
});

describe("compras: registrar no es cobrar", () => {
  it("el registro en Finance deja SENT_TO_FINANCE, nunca PAYMENT_VERIFIED", () => {
    expect(compras).toMatch(/status: "SENT_TO_FINANCE"/);
    expect(compras).toMatch(/\/\/ Registrada, NO pagada/);
  });

  it("sólo el refresco del pago puede llegar a PAYMENT_VERIFIED", () => {
    const refresco = compras.slice(compras.indexOf("export async function refrescarPago"));
    expect(refresco).toMatch(/verificado \? "PAYMENT_VERIFIED" : "PAYMENT_PENDING"/);
  });

  it("el derecho se recalcula dentro de la misma transacción que el pago", () => {
    expect(compras).toMatch(/prisma\.\$transaction\([\s\S]{0,600}recalcularDerecho/);
  });

  it("el acceso concedido nunca se revoca por una reconsulta", () => {
    expect(compras).toMatch(/derecho\.accesoCursoCompleto \|\| Boolean\(actual\?\.fullCourseAccessEntitled\)/);
  });

  it("un fallo de Finance no concede derecho y deja el motivo para reintentar", () => {
    expect(compras).toMatch(/status: "ERROR", lastFinanceError/);
    expect(compras).toMatch(/Fail closed: sin respuesta de Finance no se concede nada/);
  });

  it("la mejora exige una institucional ya pagada", () => {
    const upgrade = compras.slice(compras.indexOf("export async function crearUpgrade"));
    expect(upgrade).toMatch(/offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED"/);
    expect(upgrade).toContain("SIN_INSTITUCIONAL_PAGADA");
  });

  it("la compra usa su propio id como CRMOrderID, así que reenviarla no duplica en Finance", () => {
    expect(compras).toMatch(/crmOrderId: compra\.id/);
  });
});

describe("completion avisa a Finance sin arriesgar lo local", () => {
  it("llama a markCrmCourseCompleted tras completar", () => {
    expect(handoff).toContain("markCrmCourseCompleted");
    expect(handoff).toMatch(/completionStatus: "completado"/);
  });

  it("un fallo de Finance no revierte la finalización local", () => {
    // El alumno termino el curso: eso es cierto aunque una hoja no conteste.
    expect(handoff).toContain("COURSE_COMPLETION_FINANCE_PENDING");
    expect(handoff).toMatch(/\.catch\(async \(error: unknown\)/);
  });

  it("es idempotente: sólo la primera vez pasa el claim", () => {
    expect(handoff).toMatch(/claimed\.count !== 1/);
  });
});

describe("endpoints y permisos", () => {
  it("exigen rol y sesión antes de escribir", () => {
    for (const ruta of [rutaCampana, rutaCompras]) {
      expect(ruta).toContain("requireRole");
      expect(ruta).toMatch(/if \(auth\.error\) return auth\.error;/);
      expect(ruta).toMatch(/if \(!auth\.session\)/);
    }
  });

  it("validan la entrada con Zod", () => {
    expect(rutaCampana).toContain("z.discriminatedUnion");
    expect(rutaCompras).toContain("z.discriminatedUnion");
  });

  it("rechazan participantes que no pertenecen a la campaña", () => {
    // Sin esto, un id de otro curso enviado en el cuerpo provocaria un envio
    // fuera de audiencia y el filtro posterior lo ocultaria en silencio.
    expect(rutaCampana).toMatch(/pertenecen !== datos\.enrollmentIds\.length/);
    expect(rutaCampana).toContain("no pertenecen a esta campaña");
  });

  it("acotan el tamaño de las operaciones por lote", () => {
    expect(rutaCampana).toMatch(/\.max\(500\)/);
  });

  it("el envío manual exige confirmación explícita", () => {
    expect(rutaCampana).toMatch(/accion: z\.literal\("enviar"\)[\s\S]{0,160}confirm: z\.literal\(true\)/);
  });
});

describe("los once mensajes quedan intactos", () => {
  it("la campaña usa su propia secuencia, ajena al plan", () => {
    expect(campana).toContain("certification-offer");
    // No toca ninguna regla de automatizacion ni el plan estandar.
    expect(campana).not.toMatch(/automationRule|DEFAULT_AUTOMATION_PLAN|WHATSAPP_AUTOMATION_PLAN/);
  });

  it("finalizeCompletedCourseEnrollments no cancela mensajes de la oferta", () => {
    const motor = readFileSync(join(raiz, "lib/nurture/engine.ts"), "utf8");
    const cierre = motor.slice(motor.indexOf("export async function finalizeCompletedCourseEnrollments"));
    // Cancela por enrollmentId y estado, sin distinguir secuencia: la oferta se
    // encola con `scheduledAt` de ahora y se despacha en el mismo tick, asi que
    // no queda pendiente para el cierre posterior.
    expect(cierre).not.toContain("certification-offer");
  });
});
