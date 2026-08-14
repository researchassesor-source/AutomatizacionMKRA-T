/**
 * Cancela comunicaciones pendientes de un curso finalizado sin borrar historial.
 *
 * Uso:
 *   node scripts/cleanup-finished-course-communications.mjs --course="IA para Apoyo en Tareas Academicas"
 *   node scripts/cleanup-finished-course-communications.mjs --course="IA para Apoyo en Tareas Academicas" --apply
 *
 * Sin --apply no escribe nada. Usa DBURL si esta presente; si no, Prisma usa
 * las variables normales del entorno. No modifica .env.
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const courseTitle = args.find((arg) => arg.startsWith("--course="))?.slice("--course=".length)?.trim();

if (!courseTitle) {
  console.error('Falta --course="Nombre exacto del curso".');
  process.exit(1);
}

const prisma = new PrismaClient(process.env.DBURL ? { datasourceUrl: process.env.DBURL } : undefined);

const course = await prisma.course.findFirst({
  where: { title: courseTitle },
  select: { id: true, title: true },
});

if (!course) {
  console.error(`No se encontro el curso: ${courseTitle}`);
  await prisma.$disconnect();
  process.exit(1);
}

const where = {
  enrollment: { courseId: course.id },
  status: { in: ["PROGRAMADO", "OMITIDO"] },
  scheduledAt: { gt: new Date() },
};

const total = await prisma.outboundMessage.count({ where });
console.log(`Curso: ${course.title}`);
console.log(`Pendientes futuros a cancelar: ${total}`);
console.log("Contactos, inscripciones, enviados, fallidos y auditoria: preservados.");

if (!apply) {
  console.log("SIMULACION: no se escribio nada. Agrega --apply para cancelar.");
  await prisma.$disconnect();
  process.exit(0);
}

const now = new Date();
const [messages] = await prisma.$transaction([
  prisma.outboundMessage.updateMany({
    where,
    data: {
      status: "CANCELADO",
      cancelledAt: now,
      errorCode: "COURSE_FINISHED_CLEANUP",
      errorMessage: "Curso finalizado; se cancelaron comunicaciones futuras pendientes.",
    },
  }),
  prisma.enrollment.updateMany({
    where: { courseId: course.id, status: { in: ["INTERESADO", "INSCRITO", "EN_CURSO"] } },
    data: { status: "COMPLETADO" },
  }),
  prisma.auditLog.create({
    data: {
      actorEmail: "mantenimiento",
      action: "FINISHED_COURSE_COMMUNICATIONS_CLEANED",
      entityType: "Course",
      entityId: course.id,
      result: "SUCCESS",
      metadata: { courseTitle: course.title, pendingMessagesCancelled: total, preservedHistory: true },
    },
  }),
]);

console.log(`Cancelados: ${messages.count}`);
await prisma.$disconnect();
