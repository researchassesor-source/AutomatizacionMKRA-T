/**
 * Pone al dia el nombre de plantilla guardado en las reglas de WhatsApp.
 *
 *   ra_training_agradecimiento_final -> ra_training_fin_sesion
 *   ra_training_encuesta             -> ra_training_encuesta_experiencia
 *
 * El envio ya funciona sin ejecutar esto: `canonicalTemplate` resuelve los
 * nombres anteriores hacia la ficha nueva, de modo que ninguna regla puede
 * enviar la plantilla vieja. Esto solo ordena la base para que lo guardado diga
 * lo mismo que se envia, y para que el aviso de "regla desfasada" del preflight
 * deje de saltar.
 *
 * Toca UNICAMENTE los cuatro campos de plantilla de la regla. No modifica
 * mensajes, no reprograma, no cambia `sequenceKey`, no altera el estado
 * ACTIVE/PAUSED ni el curso, y no puede provocar un reenvio. Es idempotente.
 *
 *   npx tsx --env-file=.env scripts/renombrar-plantillas-whatsapp.ts            (simulacion)
 *   npx tsx --env-file=.env scripts/renombrar-plantillas-whatsapp.ts --aplicar
 */
import { PrismaClient } from "@prisma/client";
import { canonicalTemplate } from "../src/lib/whatsapp/templates";

const RENOMBRES = [
  { antiguo: "ra_training_agradecimiento_final", nuevo: "ra_training_fin_sesion" },
  { antiguo: "ra_training_encuesta", nuevo: "ra_training_encuesta_experiencia" },
] as const;

const aplicar = process.argv.includes("--aplicar");
const prisma = new PrismaClient();

async function main() {
  console.log(aplicar ? "Aplicando cambios.\n" : "Simulación: no se escribe nada. Añade --aplicar para ejecutar.\n");

  for (const { antiguo, nuevo } of RENOMBRES) {
    const ficha = canonicalTemplate(nuevo);
    if (!ficha || ficha.name !== nuevo) {
      console.error(`El catálogo no declara ${nuevo}. Se aborta sin tocar nada.`);
      process.exitCode = 1;
      return;
    }

    const afectadas = await prisma.automationRule.findMany({
      where: { channel: "WHATSAPP", waTemplateName: antiguo },
      select: { id: true, name: true, status: true, courseId: true },
    });

    console.log(`${antiguo} -> ${nuevo}: ${afectadas.length} regla(s)`);
    for (const regla of afectadas) console.log(`   · ${regla.name} [${regla.status}]`);
    if (afectadas.length === 0 || !aplicar) {
      console.log("");
      continue;
    }

    // Se reescribe tambien el contrato de variables: dejar el nombre nuevo con
    // las variables viejas produciria el mismo 132000 que se quiere evitar.
    const { count } = await prisma.automationRule.updateMany({
      where: { channel: "WHATSAPP", waTemplateName: antiguo },
      data: {
        waTemplateName: ficha.name,
        waTemplateLanguage: ficha.language,
        waTemplateBodyVars: [...ficha.bodyVars],
        waTemplateUrlVar: ficha.urlVar ?? null,
      },
    });
    console.log(`   actualizadas: ${count}\n`);
  }

  const pendientes = await prisma.automationRule.count({
    where: { channel: "WHATSAPP", waTemplateName: { in: RENOMBRES.map((r) => r.antiguo) } },
  });
  console.log(pendientes === 0
    ? "No queda ninguna regla con los nombres anteriores."
    : `Quedan ${pendientes} regla(s) con nombres anteriores.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
