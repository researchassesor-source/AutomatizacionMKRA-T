import { PrismaClient } from "@prisma/client";
import { runPreflight, type CheckLevel } from "../src/lib/preflight";

/**
 * Comprobación previa al despliegue. ESTRICTAMENTE DE SOLO LECTURA.
 *
 * No envía, no publica, no actualiza, no cancela, no reclama y no migra.
 * Nunca imprime secretos ni datos personales.
 *
 *   npx tsx --env-file=.env scripts/deploy-preflight.ts
 *
 * Código de salida: 0 si PASS o WARN, 1 si hay algún FAIL.
 */
const prisma = new PrismaClient();

const icon: Record<CheckLevel, string> = { PASS: "[ OK ]", WARN: "[WARN]", FAIL: "[FAIL]" };

async function main() {
  const report = await runPreflight(prisma);
  console.log(`Comprobación previa al despliegue · ${report.generatedAt}`);
  console.log("Solo lectura: no envía, no publica y no modifica nada.\n");

  let currentGroup = "";
  for (const check of report.checks) {
    if (check.group !== currentGroup) {
      currentGroup = check.group;
      console.log(`\n${currentGroup}`);
      console.log("-".repeat(currentGroup.length));
    }
    console.log(`${icon[check.level]} ${check.title}`);
    console.log(`       ${check.detail}`);
  }

  console.log(`\nResumen: ${report.summary.pass} correctos, ${report.summary.warn} avisos, ${report.summary.fail} fallos.`);
  console.log(`VEREDICTO: ${report.verdict}`);
  if (report.verdict === "FAIL") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "No se pudo completar la comprobación.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
