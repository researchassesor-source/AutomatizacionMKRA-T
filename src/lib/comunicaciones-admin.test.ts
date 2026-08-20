import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { automationRuleFields, automationRuleSchema } from "./automation-rule-schema";
import { automationRuleCanRun, courseAcceptsAutomations } from "./automation-eligibility";
import { mensajeDeVariablesDesconocidas, VARIABLES_DISPONIBLES, variablesDesconocidas, variablesUsadas } from "./template-variables";
import { TEMPLATE_VARIABLES } from "./nurture/engine";

/**
 * Administracion de comunicaciones desde el panel.
 *
 * La fuente de verdad ya existia: `AutomationRule` guarda texto, momento,
 * canal, estado y curso. Lo que faltaba era impedir que se guardara un texto
 * que el renderer no sabe resolver, y poder callar un curso sin despublicarlo.
 */
const raiz = join(process.cwd(), "src");
const REGLA_BASE = {
  courseId: "curso-1",
  name: "Bienvenida",
  trigger: "ON_REGISTRATION" as const,
  offsetMinutes: 0,
  channel: "EMAIL" as const,
  subject: "Bienvenido a {{curso}}",
  body: "Hola {{nombre}}, te esperamos en {{curso}} el {{fecha}}.",
};
const CURSO = { isPublished: true, acceptsRegistrations: true, startsAt: new Date(), endsAt: new Date() };

describe("variables de plantilla", () => {
  it("la lista mostrada es exactamente la que resuelve el renderer", () => {
    expect(VARIABLES_DISPONIBLES.map((v) => v.nombre).sort()).toEqual([...TEMPLATE_VARIABLES].sort());
  });

  it("detecta las variables escritas en un texto, sin repetir", () => {
    expect(variablesUsadas("Hola {{nombre}}, {{curso}} y otra vez {{nombre}}")).toEqual(["nombre", "curso"]);
  });

  it("una variable conocida no se marca como desconocida", () => {
    expect(variablesDesconocidas(REGLA_BASE.body)).toEqual([]);
  });

  it("señala por nombre las que el renderer no resuelve", () => {
    expect(variablesDesconocidas("Hola {{nombre}}, tu {{inventada}} y {{otra_mas}}")).toEqual(["inventada", "otra_mas"]);
  });

  it("el mensaje de error nombra la variable, no dice «texto no válido»", () => {
    expect(mensajeDeVariablesDesconocidas(["inventada"])).toContain("{{inventada}}");
    expect(mensajeDeVariablesDesconocidas(["a", "b"])).toContain("{{a}}, {{b}}");
  });
});

describe("guardar una comunicación", () => {
  it("acepta un texto con variables válidas", () => {
    expect(automationRuleSchema.safeParse(REGLA_BASE).success).toBe(true);
  });

  it("RECHAZA un texto con una variable que no existe", () => {
    // El renderer deja intacto lo que no reconoce: sin esto, `{{descuento}}`
    // llegaria escrito tal cual al contacto y nadie se enteraria.
    const resultado = automationRuleSchema.safeParse({ ...REGLA_BASE, body: "Hola {{nombre}}, tu {{descuento}} espera." });
    expect(resultado.success).toBe(false);
    if (resultado.success) return;
    expect(resultado.error.errors[0]?.message).toContain("{{descuento}}");
  });

  it("también valida el asunto del correo", () => {
    const resultado = automationRuleSchema.safeParse({ ...REGLA_BASE, subject: "Tu {{cupon}} de {{curso}}" });
    expect(resultado.success).toBe(false);
  });

  it("valida en el servidor y no solo en el formulario", () => {
    const ruta = readFileSync(join(raiz, "app/api/admin/automations/[id]/route.ts"), "utf8");
    expect(ruta).toContain("automationRuleFields");
    expect(ruta).toContain("requireRole");
  });

  it("acepta cambiar el momento del envío", () => {
    const conNuevoTiming = automationRuleFields.partial().safeParse({ trigger: "BEFORE_COURSE", offsetMinutes: 1440 });
    expect(conNuevoTiming.success).toBe(true);
  });

  it("rechaza un momento imposible", () => {
    expect(automationRuleFields.partial().safeParse({ offsetMinutes: -5 }).success).toBe(false);
    expect(automationRuleFields.partial().safeParse({ trigger: "CUANDO_SEA" }).success).toBe(false);
  });

  it("solo admite los canales ya soportados", () => {
    expect(automationRuleFields.partial().safeParse({ channel: "SMS" }).success).toBe(false);
    for (const canal of ["EMAIL", "WHATSAPP"]) {
      expect(automationRuleFields.partial().safeParse({ channel: canal }).success, canal).toBe(true);
    }
  });

  it("los cuatro estados de activación siguen siendo los mismos", () => {
    for (const estado of ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]) {
      expect(automationRuleFields.partial().safeParse({ status: estado }).success, estado).toBe(true);
    }
  });
});

describe("activar y desactivar", () => {
  it("una regla sin texto no se ejecuta", () => {
    expect(automationRuleCanRun(CURSO, { trigger: "ON_REGISTRATION", channel: "EMAIL", subject: "x", body: "  " })).toBe(false);
  });

  it("un correo sin asunto no se ejecuta", () => {
    expect(automationRuleCanRun(CURSO, { trigger: "ON_REGISTRATION", channel: "EMAIL", subject: null, body: "Hola" })).toBe(false);
  });

  it("una regla completa sí se ejecuta", () => {
    expect(automationRuleCanRun(CURSO, { trigger: "ON_REGISTRATION", channel: "EMAIL", subject: "Hola", body: "Hola" })).toBe(true);
  });
});

describe("pausa por curso", () => {
  it("un curso pausado deja de programar y enviar", () => {
    expect(courseAcceptsAutomations({ isPublished: true, automationsPausedAt: new Date() })).toBe(false);
  });

  it("otro curso sin pausa sigue funcionando", () => {
    // Es el objetivo: callar uno sin apagar los demas.
    expect(courseAcceptsAutomations({ isPublished: true, automationsPausedAt: null })).toBe(true);
  });

  it("ausente significa no pausado, así que nada cambia para los cursos existentes", () => {
    expect(courseAcceptsAutomations({ isPublished: true })).toBe(true);
  });

  it("la pausa gana aunque el curso esté publicado", () => {
    expect(automationRuleCanRun(
      { ...CURSO, automationsPausedAt: new Date() },
      { trigger: "ON_REGISTRATION", channel: "EMAIL", subject: "Hola", body: "Hola" },
    )).toBe(false);
  });

  it("despublicar sigue callando el curso, como antes", () => {
    expect(courseAcceptsAutomations({ isPublished: false, automationsPausedAt: null })).toBe(false);
  });

  it("el endpoint exige rol, confirmación y no borra nada", () => {
    const ruta = readFileSync(join(raiz, "app/api/admin/courses/[id]/automations-pause/route.ts"), "utf8");
    expect(ruta).toContain("requireRole");
    expect(ruta).toContain("confirm: z.literal(true)");
    // Solo escribe las dos columnas de la pausa: ni mensajes, ni reglas, ni inscripciones.
    expect(ruta).not.toMatch(/delete|deleteMany|outboundMessage|automationRule\./);
    expect(ruta).toContain("COURSE_AUTOMATIONS_PAUSED");
  });
});

describe("editar no reenvía nada", () => {
  const motor = readFileSync(join(raiz, "lib/nurture/engine.ts"), "utf8");
  const colaSegura = readFileSync(join(raiz, "lib/nurture/queue-safety.ts"), "utf8");

  it("los mensajes ya enviados nunca se reescriben", () => {
    // Solo lo pendiente es reprogramable; enviado, fallido o cancelado se
    // conserva como historial. La constante vive en queue-safety.ts (no en
    // engine.ts) para que el vocabulario de cuarentena/cancelación no
    // dependa del motor de programación.
    expect(colaSegura).toContain('export const REPROGRAMMABLE_STATUSES = ["PROGRAMADO", "OMITIDO"] as const');
    expect(motor).toContain('import { REPROGRAMMABLE_STATUSES } from "./queue-safety"');
  });

  it("la identidad del mensaje no depende del texto, así que editarlo no crea otro", () => {
    // La clave se construye con canal y planKey (o el id de la regla). El
    // cuerpo no entra: cambiar el texto no genera una identidad nueva y por
    // tanto no puede producir un segundo mensaje.
    expect(motor).toMatch(/leadId_enrollmentId_sequenceKey_stepKey/);
    expect(motor).toMatch(/sequenceKey: `automation:\$\{rule\.channel\}:\$\{rule\.planKey \?\? rule\.id\}`/);
    const claves = motor.slice(motor.indexOf("sequenceKey: `automation:"), motor.indexOf("stepKey: target.stepKey"));
    expect(claves).not.toMatch(/rule\.body|rule\.subject/);
  });

  it("una bienvenida creada o reactivada después de la inscripción no saluda hacia atrás", () => {
    // Es lo que impide que activar una regla reenvie a todo el historico.
    // Se compara con `activatedAt`, no con `updatedAt`: `updatedAt` cambia con
    // CUALQUIER edicion (texto, horario), asi que corregir un asunto en una
    // regla ya ACTIVE volveria a colgar la bienvenida de inscripciones
    // anteriores a esa edicion sin que nadie la hubiera pausado. `activatedAt`
    // solo se mueve en una activacion real: creacion, o vuelta desde
    // PAUSED/DRAFT/ARCHIVED. Si faltara por dato legacy, cae a `updatedAt`
    // -la frontera que Production ya usaba- en vez de tratar null como "sin
    // limite" (ultimo review de release).
    expect(motor).toMatch(/const activationBoundary = rule\.activatedAt \?\? rule\.updatedAt;/);
    expect(motor).toMatch(/rule\.trigger === "ON_REGISTRATION" && enrollment\.createdAt < activationBoundary/);
  });

  it("desactivar no cancela lo ya enviado", () => {
    // La cancelación irreversible vive en queue-safety.ts (no en engine.ts):
    // ver ahí sus propias pruebas de que nunca toca un estado histórico.
    const cancelar = colaSegura.slice(colaSegura.indexOf("export async function cancelIrreversibleMessages"));
    expect(cancelar.slice(0, 600)).toMatch(/status: \{ in: \[\.\.\.MENSAJES_RECUPERABLES\] \}/);
    expect(colaSegura).not.toMatch(/MENSAJES_RECUPERABLES[\s\S]{0,120}(ACEPTADO|ENVIADO|ENTREGADO|LEIDO)/);
  });
});

describe("la migración es aditiva", () => {
  it("solo añade dos columnas que admiten nulo", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260816010000_pausa_automatizaciones_curso/migration.sql"), "utf8");
    expect(sql).toContain('ADD COLUMN "automationsPausedAt"');
    expect(sql).toContain('ADD COLUMN "automationsPausedBy"');
    expect(sql).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE FROM)/im);
    expect(sql).not.toMatch(/NOT NULL/);
  });
});
