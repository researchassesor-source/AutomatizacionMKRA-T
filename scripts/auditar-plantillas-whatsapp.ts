/**
 * Compara las plantillas declaradas en el codigo con las registradas en Meta.
 *
 * Es la misma auditoria que ofrece el panel en
 * `/api/admin/whatsapp/templates-audit`, con la misma logica: aqui solo cambia
 * la forma de presentarla. Sirve para ejecutarla sin desplegar, con el token a
 * mano y sin pasar por el navegador.
 *
 * Solo hace peticiones GET. No envia ningun mensaje, no crea ni edita ninguna
 * plantilla y no imprime el token.
 *
 *   WHATSAPP_ACCESS_TOKEN=... WHATSAPP_WABA_ID=... npx tsx scripts/auditar-plantillas-whatsapp.ts
 *
 * El identificador de la cuenta tambien puede pasarse como argumento.
 */
import { auditarPlantillasConMeta } from "../src/lib/whatsapp/template-audit";

const wabaPorArgumento = process.argv[2]?.trim();
const env = { ...process.env, ...(wabaPorArgumento ? { WHATSAPP_WABA_ID: wabaPorArgumento } : {}) };

const resultado = await auditarPlantillasConMeta(env);

if (!resultado.ok) {
  console.error(`${resultado.errorCode}: ${resultado.error}`);
  process.exit(1);
}

console.table(
  resultado.plantillas.map((fila) => ({
    plantilla: fila.name,
    idioma: fila.language,
    estadoMeta: fila.metaStatus ?? "-",
    formato: fila.parameterFormat ?? "-",
    crm: fila.codigo.bodyParams,
    meta: fila.meta ? fila.meta.bodyParams : "-",
    resultado: fila.result,
  })),
);

for (const fila of resultado.plantillas) {
  if (fila.result !== "GREEN") console.log(`${fila.result}  ${fila.name}: ${fila.detail}`);
}

console.log(`\nGREEN ${resultado.green} · YELLOW ${resultado.yellow} · RED ${resultado.red} · total ${resultado.total}`);
console.log("Solo se hicieron peticiones GET. No se envió ningún mensaje.");
