/**
 * Variables que el renderer sabe resolver.
 *
 * Existe para que quien edita un mensaje desde el panel sepa que puede escribir
 * y no descubra el error cuando el mensaje ya salio. El renderer deja intacto
 * lo que no reconoce, asi que una variable inventada no rompe el envio: llega
 * al contacto tal cual, como `{{inventada}}`, dentro del texto. Eso es peor que
 * un fallo, porque nadie se entera.
 *
 * Este modulo es la fuente canonica de la lista; el motor la reexporta.
 */

/**
 * Lista canonica de variables que el renderer resuelve.
 *
 * Vive aqui y no en el motor a proposito: el panel de administracion es codigo
 * de navegador, y al importarla desde el motor se arrastraba al bundle todo el
 * arbol de envio —nodemailer incluido—, que no puede compilarse en el cliente.
 * El motor la reexporta para no romper a quien ya la importaba de alli.
 */
export const TEMPLATE_VARIABLES = [
  "nombre", "apellido", "curso", "courseUrl", "moodleUrl", "asesor", "fecha",
  "hora", "modalidad", "enlace", "appUrl", "streamUrl", "bloqueEnlace",
  "fechaSesion", "horaSesion", "sesion", "sesion_actual", "numero_sesion", "total_sesiones", "proxima_sesion",
  "link_reunion", "link_grupo_whatsapp", "link_curso_completo", "link_encuesta", "bloqueFecha",
  // Oferta comercial: no pertenece al plan de once mensajes.
  "link_oferta_institucional",
] as const;

export type VariableDisponible = { nombre: string; descripcion: string };

const DESCRIPCIONES: Record<string, string> = {
  nombre: "Nombre de pila del contacto",
  apellido: "Apellido del contacto",
  curso: "Título del curso",
  courseUrl: "Página pública del curso",
  moodleUrl: "Aula virtual del curso",
  asesor: "Nombre del asesor asignado",
  fecha: "Fecha de referencia del curso",
  hora: "Hora de referencia del curso",
  modalidad: "Modalidad del curso",
  enlace: "Aula virtual o, si no hay, la página del curso",
  appUrl: "Dirección del CRM",
  streamUrl: "Enlace de la reunión de la sesión",
  bloqueEnlace: "Bloque con el enlace de acceso, o vacío si no hay",
  fechaSesion: "Fecha de la sesión concreta",
  horaSesion: "Hora de la sesión concreta",
  sesion: "Nombre de la sesión",
  sesion_actual: "Nombre de la sesión actual",
  // Numeros sueltos, para textos que ya escriben "Sesión {{n}} de {{total}}".
  numero_sesion: "Número de la sesión actual (1, 2, 3…)",
  total_sesiones: "Número total de sesiones (solo el número)",
  proxima_sesion: "Fecha y hora de la siguiente sesión, o vacío si es la última",
  link_reunion: "Enlace de la reunión",
  link_grupo_whatsapp: "Grupo oficial de WhatsApp del curso",
  link_curso_completo: "Página informativa del curso completo",
  link_encuesta: "Encuesta final del curso",
  link_oferta_institucional: "Oferta de certificación institucional",
  bloqueFecha: "Bloque con fecha, hora y modalidad, o vacío si no hay",
};

/** Lista para mostrar en el panel, ya ordenada. */
export const VARIABLES_DISPONIBLES: VariableDisponible[] = [...TEMPLATE_VARIABLES]
  .map((nombre) => ({ nombre, descripcion: DESCRIPCIONES[nombre] ?? "" }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre));

/** Nombres de variable escritos en un texto, sin repetir. */
export function variablesUsadas(texto: string): string[] {
  const encontradas = [...texto.matchAll(/\{\{(\w+)\}\}/g)].map((coincidencia) => coincidencia[1]);
  return [...new Set(encontradas)];
}

/**
 * Variables que el renderer no sabe resolver.
 *
 * Se devuelven en lugar de lanzar para que quien llama decida: la validacion
 * del formulario las convierte en un mensaje concreto con los nombres, que es
 * mucho mas util que un "texto no válido".
 */
export function variablesDesconocidas(texto: string): string[] {
  const conocidas = new Set<string>(TEMPLATE_VARIABLES);
  return variablesUsadas(texto).filter((nombre) => !conocidas.has(nombre));
}

export function mensajeDeVariablesDesconocidas(desconocidas: readonly string[]): string {
  const lista = desconocidas.map((nombre) => `{{${nombre}}}`).join(", ");
  return desconocidas.length === 1
    ? `La variable ${lista} no existe, así que se enviaría tal cual al contacto. Revísala o quítala.`
    : `Estas variables no existen y se enviarían tal cual al contacto: ${lista}.`;
}
