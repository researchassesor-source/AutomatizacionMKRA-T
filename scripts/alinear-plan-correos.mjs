/**
 * Alinea las reglas de correo heredadas con el plan estándar de cinco correos.
 *
 * Las reglas de esta base se crearon a mano antes de que existiera el plan, así
 * que no tienen `planKey`. Eso tiene dos consecuencias malas: aplicar el plan
 * desde el panel crearía un segundo juego de reglas (y cada persona recibiría
 * todo por duplicado), y falta por completo el recordatorio de 15 minutos.
 *
 * Este script:
 *   1. Reescribe los textos conservando el ID de cada regla. Cambiar el ID
 *      cambiaría `sequenceKey` y volvería a enviar la bienvenida a quien ya la
 *      recibió, porque esa regla está exenta del filtro de fechas pasadas.
 *   2. Deja una sola regla de agradecimiento por curso y archiva la duplicada.
 *   3. Crea el recordatorio de 15 minutos, que no existía en ningún curso.
 *   4. Asigna `planKey` para que reaplicar el plan sea idempotente.
 *   5. Activa las reglas para que funcionen en cuanto el curso tenga fechas.
 *
 * Uso:
 *   node scripts/alinear-plan-correos.mjs           (simulación, no escribe)
 *   node scripts/alinear-plan-correos.mjs --aplicar (escribe)
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_AUTOMATION_PLAN } from "../src/lib/nurture/default-automations.ts";

const APLICAR = process.argv.includes("--aplicar");
const prisma = new PrismaClient({ datasourceUrl: process.env.DBURL });

/** Cada entrada del plan ocupa un hueco único de disparador + minutos. */
const HUECO = new Map(DEFAULT_AUTOMATION_PLAN.map((e) => [`${e.trigger}@${e.offsetMinutes}`, e]));

const cursos = await prisma.course.findMany({
  select: {
    id: true,
    title: true,
    isPublished: true,
    automationRules: {
      where: { channel: "EMAIL", status: { not: "ARCHIVED" } },
      select: { id: true, trigger: true, offsetMinutes: true, status: true, planKey: true, createdAt: true, _count: { select: { messages: true } } },
      orderBy: { createdAt: "asc" },
    },
  },
  orderBy: { title: "asc" },
});

const acciones = { actualizadas: 0, creadas: 0, archivadas: 0, activadas: 0 };
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
    // la más antigua. El resto se archiva para no duplicar envíos.
    const conservada = existentes.find((r) => r._count.messages > 0) ?? existentes[0] ?? null;
    for (const sobrante of existentes.filter((r) => r !== conservada)) {
      plan.push({ tipo: "archivar", cursoId: curso.id, curso: curso.title, clave, id: sobrante.id });
      acciones.archivadas++;
    }
    if (conservada) {
      plan.push({ tipo: "actualizar", cursoId: curso.id, curso: curso.title, clave, id: conservada.id, entrada, estadoPrevio: conservada.status });
      acciones.actualizadas++;
      if (conservada.status !== "ACTIVE") acciones.activadas++;
    } else {
      plan.push({ tipo: "crear", cursoId: curso.id, curso: curso.title, clave, entrada });
      acciones.creadas++;
    }
  }
}

console.log(`Cursos: ${cursos.length} (publicados: ${cursos.filter((c) => c.isPublished).length})`);
console.log(`\nA actualizar: ${acciones.actualizadas}  ·  a crear: ${acciones.creadas}  ·  a archivar: ${acciones.archivadas}  ·  pasan a activas: ${acciones.activadas}`);

const porTipo = new Map();
for (const p of plan) {
  const k = `${p.tipo} ${p.clave}`;
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
for (const p of plan) {
  if (p.tipo === "archivar") {
    await prisma.automationRule.update({ where: { id: p.id }, data: { status: "ARCHIVED", planKey: null } });
    continue;
  }
  const datos = {
    name: p.entrada.name,
    subject: p.entrada.subject,
    body: p.entrada.body,
    requiresStreamUrl: p.entrada.requiresStreamUrl,
    enrollmentStatuses: p.entrada.enrollmentStatuses,
    planKey: p.entrada.planKey,
    status: "ACTIVE",
  };
  if (p.tipo === "actualizar") {
    await prisma.automationRule.update({ where: { id: p.id }, data: datos });
  } else {
    await prisma.automationRule.create({
      data: {
        ...datos,
        courseId: p.cursoId,
        trigger: p.entrada.trigger,
        offsetMinutes: p.entrada.offsetMinutes,
        channel: "EMAIL",
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
      motivo: "Alineacion de las reglas heredadas con el plan estandar de cinco correos",
      ...acciones,
      nota: "Se conservaron los IDs de las reglas existentes para no reenviar bienvenidas ya entregadas",
    },
  },
});

console.log(`\nListo. Actualizadas ${acciones.actualizadas}, creadas ${acciones.creadas}, archivadas ${acciones.archivadas}.`);
await prisma.$disconnect();
