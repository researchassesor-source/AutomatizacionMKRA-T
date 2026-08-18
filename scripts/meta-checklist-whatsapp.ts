/**
 * Imprime las definiciones que hay que reproducir a mano en Meta.
 *
 * El CRM ya no se adapta a lo que haya registrado: el contrato canonico vive en
 * el codigo y Meta debe quedar igual. Esto lo saca en un formato que se puede
 * copiar y pegar en el gestor de plantillas, para no transcribir a ojo un texto
 * del que depende que el envio no falle.
 *
 * No contacta con Meta ni con la base de datos: solo lee el catalogo.
 *
 *   npx tsx scripts/meta-checklist-whatsapp.ts
 */
import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from "../src/lib/whatsapp/templates";

const JOURNEY: WhatsAppTemplateKey[] = [
  "welcome", "whatsapp_group", "reminder_24h", "reminder_2h", "reminder_15m",
  "session_live", "late_access", "session_complete", "course_complete",
  "course_follow_up", "survey",
];

function bloque(clave: WhatsAppTemplateKey, posicion: number | null) {
  const spec = WHATSAPP_TEMPLATES[clave];
  const encabezado = posicion === null ? "FUERA DEL JOURNEY" : `# ${posicion}`;
  const variables = spec.bodyVars.map((nombre, i) => `  {{${i + 1}}}  ${nombre}`).join("\n");
  return [
    "".padEnd(70, "-"),
    `${encabezado}   ${spec.name}`,
    "".padEnd(70, "-"),
    `Idioma:     ${spec.language}`,
    `Categoría:  ${spec.category}`,
    `Variables:  ${spec.bodyVars.length}`,
    variables,
    "",
    "BODY:",
    spec.sample,
    "",
  ].join("\n");
}

console.log("PLANTILLAS DE WHATSAPP — contrato canónico del CRM");
console.log("Reproducir estas definiciones en Meta. Ninguna usa cabecera ni botón.\n");
for (const [i, clave] of JOURNEY.entries()) console.log(bloque(clave, i + 1));
console.log(bloque("certification_offer", null));

const totales = JOURNEY.map((c) => `${WHATSAPP_TEMPLATES[c].name}=${WHATSAPP_TEMPLATES[c].bodyVars.length}`);
console.log("".padEnd(70, "-"));
console.log(`Journey: ${JOURNEY.length} plantillas · ${totales.join(" · ")}`);
console.log("Los nombres ra_training_agradecimiento_final y ra_training_encuesta quedan obsoletos.");
