import type { AutomationTrigger, EnrollmentStatus } from "@prisma/client";
import { templateBodyWithPlaceholders, WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from "@/lib/whatsapp/templates";
import type { AutomationPlanKey } from "./default-automations";

/**
 * Plan estandar de WhatsApp: los mismos cinco momentos que el de correo.
 *
 * Se mantiene aparte del plan de correo a proposito. Comparten los momentos y
 * la audiencia, pero no el contenido: el correo lleva un cuerpo redactado y
 * WhatsApp lleva el nombre de una plantilla aprobada mas sus parametros. Un
 * unico plan con campos opcionales por canal invitaria justo al error que
 * queremos impedir, que una regla de WhatsApp acabe con cuerpo y sin plantilla.
 *
 * El `body` que se guarda aqui no viaja a Meta: es el texto que el panel
 * muestra y el que queda como historial legible del mensaje. Lo que WhatsApp
 * recibe son los parametros de la plantilla.
 */
export type WhatsAppPlanEntry = {
  planKey: AutomationPlanKey;
  templateKey: WhatsAppTemplateKey;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  offsetMinutes: number;
  /**
   * Cuerpo legible del mensaje, con los marcadores del motor. No viaja a Meta:
   * lo que Meta recibe son los parametros. Se DERIVA del texto registrado en
   * la plantilla, no se escribe a mano.
   *
   * Escribirlo aparte fue justo lo que produjo la inconsistencia que motivo
   * esto: el CRM enseñaba un mensaje redactado por su cuenta mientras Meta
   * enviaba otro. Un solo texto de origen hace imposible que vuelvan a
   * separarse.
   */
  body: string;
  requiresStreamUrl: boolean;
  enrollmentStatuses: EnrollmentStatus[];
};

const REGISTERED_AUDIENCE: EnrollmentStatus[] = ["INTERESADO", "INSCRITO", "EN_CURSO"];

/** Todo lo del plan salvo el cuerpo, que se deriva de la plantilla. */
type WhatsAppPlanDraft = Omit<WhatsAppPlanEntry, "body">;

const PLAN_SIN_CUERPO: readonly WhatsAppPlanDraft[] = [
  {
    planKey: "welcome",
    templateKey: "welcome",
    name: "Bienvenida inmediata · WhatsApp",
    description: "Se envía apenas se registra la inscripción, con plantilla aprobada.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 0,
    requiresStreamUrl: false,
    enrollmentStatuses: REGISTERED_AUDIENCE,
  },
  {
    planKey: "reminder_24h",
    templateKey: "reminder_24h",
    name: "Recordatorio 24 horas antes · WhatsApp",
    description: "Un recordatorio por sesión, 24 horas antes. No lleva el enlace.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 24 * 60,
    requiresStreamUrl: false,
    enrollmentStatuses: REGISTERED_AUDIENCE,
  },
  {
    planKey: "reminder_2h",
    templateKey: "reminder_2h",
    name: "Acceso 2 horas antes · WhatsApp",
    description: "Entrega el enlace de la reunión. Necesita enlace configurado.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 120,
    // A diferencia del correo, aqui SI se exige el enlace: la plantilla lo
    // lleva como parametro obligatorio y Meta rechaza un parametro vacio.
    requiresStreamUrl: true,
    enrollmentStatuses: REGISTERED_AUDIENCE,
  },
  {
    planKey: "reminder_15m",
    templateKey: "reminder_15m",
    name: "Acceso 15 minutos antes · WhatsApp",
    description: "Repite el enlace cuando la sesión está por empezar.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 15,
    requiresStreamUrl: true,
    enrollmentStatuses: REGISTERED_AUDIENCE,
  },
  {
    planKey: "thank_you",
    templateKey: "thank_you",
    name: "Agradecimiento final · WhatsApp",
    description: "Se envía una hora después de terminar la última sesión.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 60,
    requiresStreamUrl: false,
    enrollmentStatuses: [...REGISTERED_AUDIENCE, "COMPLETADO"],
  },
];

/**
 * El plan, ya con el cuerpo derivado del texto registrado en Meta.
 *
 * Aqui esta la garantia: el cuerpo no se puede editar sin editar la plantilla,
 * porque no existe como texto independiente.
 */
export const WHATSAPP_AUTOMATION_PLAN: readonly WhatsAppPlanEntry[] = PLAN_SIN_CUERPO.map((entry) => ({
  ...entry,
  body: templateBodyWithPlaceholders(WHATSAPP_TEMPLATES[entry.templateKey]),
}));

/** Campos de plantilla que hay que guardar en la regla para esta entrada. */
export function templateFieldsFor(entry: WhatsAppPlanEntry) {
  const spec = WHATSAPP_TEMPLATES[entry.templateKey];
  return {
    waTemplateName: spec.name,
    waTemplateLanguage: spec.language,
    waTemplateBodyVars: [...spec.bodyVars],
    waTemplateUrlVar: spec.urlVar ?? null,
  };
}
