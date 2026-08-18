import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from "@/lib/whatsapp/templates";

/**
 * Plantillas que el panel puede ofrecer para una respuesta manual.
 *
 * Se deriva del catalogo, no se reescribe: duplicar los nombres de Meta en la
 * interfaz es como acaban divergiendo. Y la exclusion de la oferta
 * institucional se declara aqui ademas de en el servidor —que tambien la
 * rechaza— porque ofrecer un boton que siempre falla es una trampa para quien
 * atiende.
 */
const FUERA_DE_BANDEJA: ReadonlySet<WhatsAppTemplateKey> = new Set(["certification_offer"]);

const ETIQUETAS: Record<WhatsAppTemplateKey, string> = {
  welcome: "Bienvenida",
  whatsapp_group: "Grupo de WhatsApp",
  reminder_24h: "Recordatorio 24 horas",
  reminder_2h: "Acceso 2 horas",
  reminder_15m: "Acceso 15 minutos",
  session_live: "Sesión en vivo",
  late_access: "Acceso para rezagados",
  thank_you: "Fin de sesión",
  course_complete: "Curso completo",
  course_follow_up: "Seguimiento",
  survey: "Encuesta",
  certification_offer: "Oferta institucional",
};

export type PlantillaDeBandeja = {
  key: WhatsAppTemplateKey;
  label: string;
  /** Variables que hay que resolver: sirve para explicar que falta. */
  variables: readonly string[];
};

export const PLANTILLAS_DE_BANDEJA: readonly PlantillaDeBandeja[] = (
  Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]
)
  .filter((clave) => !FUERA_DE_BANDEJA.has(clave))
  .map((clave) => ({ key: clave, label: ETIQUETAS[clave], variables: WHATSAPP_TEMPLATES[clave].bodyVars }));

/** ¿Esta plantilla necesita datos del curso para poder armarse? */
export function necesitaInscripcion(clave: WhatsAppTemplateKey): boolean {
  return WHATSAPP_TEMPLATES[clave].bodyVars.some((v) => v !== "nombre");
}
