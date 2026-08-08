/**
 * Imprime las cinco plantillas tal como las recibiria un contacto.
 *
 * Existe para poder comparar a ojo, lado a lado, lo que dice el codigo con lo
 * que esta registrado en Meta. La prueba de contrato ya compara el texto
 * caracter a caracter, pero cuando alguien da de alta una plantilla nueva o la
 * edita en Meta necesita ver el resultado, no un diff de una prueba.
 *
 * Uso:
 *   npx tsx scripts/verificar-plantillas-whatsapp.ts
 *
 * No toca la base de datos, no lee credenciales y no contacta con Meta.
 */
import { fillTemplateBody, WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";

const EJEMPLO: Record<string, string> = {
  nombre: "Nombre de prueba",
  curso: "Curso de prueba",
  fecha: "20 de agosto de 2026",
  hora: "7:30 p. m.",
  fechaSesion: "20 de agosto de 2026",
  horaSesion: "7:30 p. m.",
  streamUrl: "https://meet.google.com/prueba-crm",
};

for (const spec of Object.values(WHATSAPP_TEMPLATES)) {
  console.log("=".repeat(68));
  console.log(`${spec.name}   ·   idioma ${spec.language}   ·   ${spec.bodyVars.length} parámetros`);
  console.log(`orden: ${spec.bodyVars.join(" → ")}`);
  console.log("-".repeat(68));
  console.log(fillTemplateBody(spec, (variable) => EJEMPLO[variable] ?? `{{${variable}}}`));
  console.log();
}
