/**
 * Alinea las reglas heredadas de un canal con su plan estandar de cinco pasos.
 *
 * Las reglas de esta base se crearon a mano antes de que existiera el plan, asi
 * que no tienen `planKey`. Eso tiene dos consecuencias malas: aplicar el plan
 * desde el panel crearia un segundo juego de reglas (y cada persona recibiria
 * todo por duplicado), y falta por completo el paso de 15 minutos.
 *
 * Que hace, para cada curso y para el canal indicado:
 *   1. Reescribe los textos conservando el ID de cada regla. Cambiar el ID
 *      cambiaria `sequenceKey` y volveria a enviar la bienvenida a quien ya la
 *      recibio, porque esa regla esta exenta del filtro de fechas pasadas.
 *   2. Deja una sola regla por hueco y archiva las duplicadas.
 *   3. Crea los huecos que falten.
 *   4. Asigna `planKey` (y la plantilla, en WhatsApp) para que reaplicar el
 *      plan desde el panel sea idempotente.
 *   5. Ajusta el estado solo si se pide explicitamente.
 *
 * Uso:
 *   node scripts/alinear-plan-automatizaciones.mjs --canal=EMAIL
 *   node scripts/alinear-plan-automatizaciones.mjs --canal=WHATSAPP --aplicar
 *   node scripts/alinear-plan-automatizaciones.mjs --canal=EMAIL --aplicar --estado=ACTIVE
 *
 * Sin `--aplicar` solo simula. Sin `--estado`, el estado de cada regla se
 * conserva tal cual esta y las reglas nuevas nacen PAUSED: activar un canal es
 * una decision deliberada, no un efecto secundario de ordenar los textos.
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_AUTOMATION_PLAN } from "../src/lib/nurture/default-automations.ts";
import { WHATSAPP_AUTOMATION_PLAN, templateFieldsFor } from "../src/lib/nurture/default-automations-whatsapp.ts";

const args = process.argv.slice(2);
const APLICAR = args.includes("--aplicar");
const CANAL = (args.find((a) => a.startsWith("--canal="))?.split("=")[1] ?? "EMAIL").toUpperCase();
const ESTADO = args.find((a) => a.startsWith("--estado="))?.split("=")[1]?.toUpperCase() ?? null;

if (!["EMAIL", "WHATSAPP"].includes(CANAL)) {
  console.error(`Canal no válido: ${CANAL}. Usa --canal=EMAIL o --canal=WHATSAPP.`);
  process.exit(1);
}
if (ESTADO && !["ACTIVE", "PAUSED", "DRAFT"].includes(ESTADO)) {
  console.error(`Estado no válido: ${ESTADO}. Usa ACTIVE, PAUSED o DRAFT.`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: process.env.DBURL });

/** Datos que debe tener una regla de este canal para el paso indicado. */
function datosDe(entry) {
  if (CANAL === "EMAIL") {
    return {
      name: entry.name,
      subject: entry.subject,
      body: entry.body,
      requiresStreamUrl: entry.requiresStreamUrl,
      enrollmentStatuses: entry.enrollmentStatuses,
      planKey: entry.planKey,
      waTemplateName: null,
      waTemplateLanguage: null,
      waTemplateBodyVars: undefined,
      waTemplateUrlVar: null,
    };
  }
  const plantilla = templateFieldsFor(entry);
  return {
    name: entry.name,
    // WhatsApp no tiene asunto: dejarlo con texto seria un campo muerto.
    subject: null,
    body: entry.body,
    requiresStreamUrl: entry.requiresStreamUrl,
    enrollmentStatuses: entry.enrollmentStatuses,
    planKey: entry.planKey,
    ...plantilla,
  };
}

const PLAN = CANAL === "EMAIL" ? DEFAULT_AUTOMATION_PLAN : WHATSAPP_AUTOMATION_PLAN;
const HUECO = new Map(PLAN.map((entry) => [`${entry.trigger}@${entry.offsetMinutes}`, entry]));

const cursos = await prisma.course.findMany({
  select: {
    id: true,
    title: true,
    isPublished: true,
    automationRules: {
      where: { channel: CANAL, status: { not: "ARCHIVED" } },
      select: { id: true, trigger: true, offsetMinutes: true, status: true, _count: { select: { messages: true } } },
      orderBy: { createdAt: "asc" },
    },
  },
  orderBy: { title: "asc" },
});

const acciones = { actualizadas: 0, creadas: 0, archivadas: 0 };
const plan = [];

for (const curso of cursos) {
  const porHueco = new Map();
  for (const regla of curso.automationRules) {
    const clave = `${regla.trigger}@${regla.offsetMinutes}`;
    if (!porHueco.has(clave)) porHueco.set(clave, []);
    porHueco.get(clave).push(regla);
  }

  for (const [clave, entrada] of HUECO) {
    const existentes = porHueco.get(clave) ?? [];
    // Se conserva la que ya tenga historial de mensajes; si ninguna lo tiene,
    // la mas antigua. El resto se archiva para no duplicar envios.
    const conservada = existentes.find((r) => r._count.messages > 0) ?? existentes[0] ?? null;
    for (const sobrante of existentes.filter((r) => r !== conservada)) {
      plan.push({ tipo: "archivar", curso: curso.title, clave, id: sobrante.id });
      acciones.archivadas++;
    }
    if (conservada) {
      plan.push({ tipo: "actualizar", curso: curso.title, clave, id: conservada.id, entrada, estadoPrevio: conservada.status });
      acciones.actualizadas++;
    } else {
      plan.push({ tipo: "crear", cursoId: curso.id, curso: curso.title, clave, entrada });
      acciones.creadas++;
    }
  }
}

console.log(`Canal: ${CANAL}`);
console.log(`Cursos: ${cursos.length} (publicados: ${cursos.filter((c) => c.isPublished).length})`);
console.log(`Estado a aplicar: ${ESTADO ?? "conservar el actual (las nuevas nacen PAUSED)"}`);
console.log(`\nA actualizar: ${acciones.actualizadas}  ·  a crear: ${acciones.creadas}  ·  a archivar: ${acciones.archivadas}`);

const porTipo = new Map();
for (const item of plan) {
  const k = `${item.tipo} ${item.clave}`;
  porTipo.set(k, (porTipo.get(k) ?? 0) + 1);
}
console.log("\nDetalle por hueco:");
for (const [k, n] of [...porTipo].sort()) console.log(`  ${k.padEnd(38)} ${n}`);

if (!APLICAR) {
  console.log("\nSIMULACIÓN: no se escribió nada. Añade --aplicar para ejecutarlo.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\nAplicando…");
for (const item of plan) {
  if (item.tipo === "archivar") {
    await prisma.automationRule.update({ where: { id: item.id }, data: { status: "ARCHIVED", planKey: null } });
    continue;
  }
  const datos = datosDe(item.entrada);
  if (item.tipo === "actualizar") {
    await prisma.automationRule.update({
      where: { id: item.id },
      data: { ...datos, ...(ESTADO ? { status: ESTADO } : {}) },
    });
  } else {
    await prisma.automationRule.create({
      data: {
        ...datos,
        courseId: item.cursoId,
        trigger: item.entrada.trigger,
        offsetMinutes: item.entrada.offsetMinutes,
        channel: CANAL,
        // Una regla nueva nunca nace enviando: si no se pide un estado, queda
        // en pausa para que alguien decida activarla a conciencia.
        status: ESTADO ?? "PAUSED",
      },
    });
  }
}

await prisma.auditLog.create({
  data: {
    actorEmail: "mantenimiento",
    action: "AUTOMATION_PLAN_APPLIED",
    entityType: "AutomationRule",
    result: "SUCCESS",
    metadata: {
      canal: CANAL,
      motivo: "Alineacion de las reglas heredadas con el plan estandar de cinco pasos",
      estadoAplicado: ESTADO ?? "conservado",
      ...acciones,
      nota: "Se conservaron los IDs de las reglas existentes para no reenviar mensajes ya entregados",
    },
  },
});

console.log(`\nListo. Actualizadas ${acciones.actualizadas}, creadas ${acciones.creadas}, archivadas ${acciones.archivadas}.`);
await prisma.$disconnect();
