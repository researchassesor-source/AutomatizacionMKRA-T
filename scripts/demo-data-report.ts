import { PrismaClient } from "@prisma/client";

/**
 * Inventario de registros candidatos a limpieza. SOLO LECTURA.
 *
 * No elimina nada: produce el listado que exige el procedimiento antes de
 * cualquier borrado. La eliminación definitiva se hace desde el panel, contacto
 * por contacto, con confirmación del nombre completo y auditoría.
 *
 *   npx tsx --env-file=.env scripts/demo-data-report.ts
 */
const TEST_EMAIL_DOMAINS = ["example.test", "example.com", "example.org", "test.com", "mailinator.com"];

const prisma = new PrismaClient();

function line(label: string, value: string | number) {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

async function main() {
  console.log("== Inventario de datos de prueba (solo lectura) ==\n");

  const classified = await prisma.lead.findMany({
    where: { classification: { in: ["TEST", "DEMO"] } },
    select: { id: true, fullName: true, email: true, classification: true, createdAt: true, _count: { select: { enrollments: true, messages: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Contactos marcados como prueba o demostración: ${classified.length}`);
  for (const lead of classified) {
    line(`${lead.classification} · ${lead.fullName}`, `${lead.email} · ${lead._count.enrollments} inscripciones · ${lead._count.messages} mensajes`);
  }

  const suspectEmails = await prisma.lead.findMany({
    where: {
      classification: { notIn: ["TEST", "DEMO"] },
      OR: TEST_EMAIL_DOMAINS.map((domain) => ({ email: { endsWith: `@${domain}` } })),
    },
    select: { id: true, fullName: true, email: true, classification: true },
  });
  console.log(`\nContactos reales o sin clasificar con dominio de prueba: ${suspectEmails.length}`);
  console.log("  Revisar antes de tocarlos: la clasificación manda, no el dominio.");
  for (const lead of suspectEmails) line(lead.fullName, `${lead.email} (${lead.classification})`);

  const unclassified = await prisma.lead.count({ where: { classification: "UNKNOWN" } });
  console.log(`\nContactos sin clasificar (UNKNOWN): ${unclassified}`);
  console.log("  No reciben automatizaciones hasta clasificarlos como REAL.");

  const unpublishedCourses = await prisma.course.findMany({
    where: { isPublished: false },
    select: { slug: true, title: true, syncStatus: true, _count: { select: { enrollments: true } } },
  });
  console.log(`\nCursos no publicados: ${unpublishedCourses.length}`);
  for (const course of unpublishedCourses) line(course.title, `${course.slug} · ${course.syncStatus} · ${course._count.enrollments} inscripciones`);

  const simulatedMessages = await prisma.outboundMessage.count({ where: { isSimulation: true } });
  const simulatedPosts = await prisma.socialPost.count({ where: { status: "SIMULADO" } });
  console.log("\nRegistros generados por pruebas en simulación:");
  line("Mensajes simulados", simulatedMessages);
  line("Publicaciones simuladas", simulatedPosts);
  console.log("  Son evidencia de las pruebas. Conviene archivarlos, no eliminarlos.");

  console.log("\nQué NO se debe eliminar:");
  console.log("  · Contactos REAL, aunque parezcan pruebas.");
  console.log("  · Mensajes en estado ACEPTADO, ENVIADO o ENTREGADO (historial verificable).");
  console.log("  · Publicaciones con identificador del proveedor (existen en Facebook o Instagram).");
  console.log("  · Registros de auditoría.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo generar el inventario.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
