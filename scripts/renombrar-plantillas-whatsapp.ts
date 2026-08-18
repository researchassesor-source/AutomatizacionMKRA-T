/**
 * Actualiza en las reglas los dos nombres de plantilla que cambiaron.
 *
 *   ra_training_agradecimiento_final -> ra_training_fin_sesion
 *   ra_training_encuesta             -> ra_training_encuesta_experiencia
 *
 * Hace falta porque el catalogo del codigo manda sobre la copia guardada en la
 * regla SOLO cuando el nombre coincide con una plantilla conocida. Al cambiar
 * el nombre, las reglas antiguas dejan de encontrar su ficha y el motor cae en
 * la copia vieja, que apunta a una plantilla que ya no existira en Meta.
 *
 * Toca UNICAMENTE configuracion de reglas: nombre, idioma y variables de la
 * plantilla. No modifica mensajes ya enviados, no reprograma nada, no cambia
 * `sequenceKey` y no puede provocar un reenvio. Es idempotente: ejecutarlo dos
 * veces deja el mismo resultado.
 *
 *   npx tsx --env-file=.env scripts/renombrar-plantillas-whatsapp.ts          (simulacion)
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
    if (!ficha) {
      console.error(`El catálogo no declara ${nuevo}. Se aborta sin tocar nada.`);
      process.exitCode = 1;
      return;
    }

    const afectadas = await prisma.automationRule.findMany({
      where: { channel: "WHATSAPP", waTemplateName: antiguo },
      select: { id: true, name: true, status: true },
    });

    console.log(`${antiguo} -> ${nuevo}: ${afectadas.length} regla(s)`);
    for (const regla of afectadas) console.log(`   · ${regla.name} [${regla.status}]`);
    if (afectadas.length === 0 || !aplicar) continue;

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
  console.log(pendientes === 0 ? "\nNo queda ninguna regla con los nombres antiguos." : `\nQuedan ${pendientes} regla(s) con nombres antiguos.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
