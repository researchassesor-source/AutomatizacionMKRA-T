import type { AutomationTrigger, EnrollmentStatus } from "@prisma/client";
import { templateBodyWithPlaceholders, WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from "@/lib/whatsapp/templates";
import type { AutomationPlanKey } from "./default-automations";

export type WhatsAppPlanEntry = {
  planKey: AutomationPlanKey;
  templateKey: WhatsAppTemplateKey;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  offsetMinutes: number;
  body: string;
  requiresStreamUrl: boolean;
  requiresSurveyUrl?: boolean;
  enrollmentStatuses: EnrollmentStatus[];
};

const AUDIENCE: EnrollmentStatus[] = ["INTERESADO", "INSCRITO", "EN_CURSO"];

type WhatsAppPlanDraft = Omit<WhatsAppPlanEntry, "body">;

const PLAN_SIN_CUERPO: readonly WhatsAppPlanDraft[] = [
  {
    planKey: "welcome",
    templateKey: "welcome",
    name: "Bienvenida inmediata - WhatsApp",
    description: "Se envia apenas se registra la inscripcion, con plantilla aprobada.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 0,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "whatsapp_group",
    templateKey: "whatsapp_group",
    name: "Grupo de WhatsApp",
    description: "Entrega la orientacion inicial posterior al registro.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 2,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_24h",
    templateKey: "reminder_24h",
    name: "Recordatorio 24 horas antes - WhatsApp",
    description: "Un recordatorio por sesion, 24 horas antes.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 24 * 60,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_2h",
    templateKey: "reminder_2h",
    name: "Acceso 2 horas antes - WhatsApp",
    // El texto canonico avisa y pide preparar el equipo, pero NO lleva enlace:
    // ese llega a los 15 minutos. Por eso no exige enlace configurado, y un
    // curso sin enlace todavia recibe el aviso.
    description: "Avisa con dos horas de antelacion. No incluye el enlace.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 120,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_15m",
    templateKey: "reminder_15m",
    name: "Acceso 15 minutos antes - WhatsApp",
    description: "Repite el enlace cuando la sesion esta por empezar.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 15,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "session_live",
    templateKey: "session_live",
    name: "Sesion en vivo - WhatsApp",
    description: "Aviso al comenzar cada sesion.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 0,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "late_access",
    templateKey: "late_access",
    name: "Acceso rezagados - WhatsApp",
    description: "Reenvia el enlace unos minutos despues del inicio.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 20,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "session_complete",
    templateKey: "session_complete",
    name: "Fin de sesion - WhatsApp",
    description: "Cierra el curso al terminar la ultima sesion.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 5,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "course_complete",
    templateKey: "course_complete",
    name: "Curso completo - WhatsApp",
    description: "Entrega el enlace informativo del curso completo.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 60,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "course_follow_up",
    templateKey: "course_follow_up",
    name: "Seguimiento curso - WhatsApp",
    description: "Seguimiento breve posterior al cierre.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 25 * 60,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "survey",
    templateKey: "survey",
    name: "Encuesta final - WhatsApp",
    description: "Solicita la encuesta final configurada en el curso.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 48 * 60,
    requiresStreamUrl: false,
    requiresSurveyUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
];

export const WHATSAPP_AUTOMATION_PLAN: readonly WhatsAppPlanEntry[] = PLAN_SIN_CUERPO.map((entry) => ({
  ...entry,
  body: templateBodyWithPlaceholders(WHATSAPP_TEMPLATES[entry.templateKey]),
}));

export function templateFieldsFor(entry: WhatsAppPlanEntry) {
  const spec = WHATSAPP_TEMPLATES[entry.templateKey];
  return {
    waTemplateName: spec.name,
    waTemplateLanguage: spec.language,
    waTemplateBodyVars: [...spec.bodyVars],
    waTemplateUrlVar: spec.urlVar ?? null,
  };
}
