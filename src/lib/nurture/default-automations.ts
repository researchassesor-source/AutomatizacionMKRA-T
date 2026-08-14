import type { AutomationTrigger, EnrollmentStatus } from "@prisma/client";

/**
 * Plan estandar de comunicaciones por curso.
 *
 * Cada entrada queda guardada como AutomationRule normal. `planKey` es la
 * identidad estable que evita duplicar mensajes al reaplicar el plan.
 */
export type AutomationPlanKey =
  | "welcome"
  | "whatsapp_group"
  | "reminder_24h"
  | "reminder_2h"
  | "reminder_15m"
  | "session_live"
  | "late_access"
  | "course_complete"
  | "course_follow_up"
  | "survey"
  | "thank_you";

export type AutomationPlanEntry = {
  planKey: AutomationPlanKey;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  offsetMinutes: number;
  subject: string;
  body: string;
  requiresStreamUrl: boolean;
  requiresSurveyUrl?: boolean;
  enrollmentStatuses: EnrollmentStatus[];
};

const AUDIENCE: EnrollmentStatus[] = ["INTERESADO", "INSCRITO", "EN_CURSO"];

export const DEFAULT_AUTOMATION_PLAN: readonly AutomationPlanEntry[] = [
  {
    planKey: "welcome",
    name: "Bienvenida inmediata",
    description: "Se envia apenas se registra la inscripcion.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 0,
    subject: "Tu inscripcion a {{curso}} esta confirmada",
    body: `Hola {{nombre}},

Tu inscripción a {{curso}} quedo registrada correctamente.

{{bloqueFecha}}

Te enviaremos recordatorios y enlaces de acceso antes de cada sesion.

Gracias por ser parte de R.A. Training.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "whatsapp_group",
    name: "Grupo de WhatsApp",
    description: "Comparte la informacion inicial del curso despues del registro.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 2,
    subject: "Informacion inicial de {{curso}}",
    body: `Hola {{nombre}},

Tu cupo para {{curso}} ya esta registrado.

Grupo oficial de WhatsApp:
{{link_grupo_whatsapp}}

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_24h",
    name: "Recordatorio 24 horas antes",
    description: "Un recordatorio por cada sesion, 24 horas antes de su inicio.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 24 * 60,
    subject: "Manana nos vemos en {{curso}}",
    body: `Hola {{nombre}},

Te recordamos que manana tienes {{sesion_actual}} de {{curso}}.

Fecha: {{fechaSesion}}
Hora: {{horaSesion}}

Te recomendamos reservar el horario y revisar tu conexion con anticipacion.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_2h",
    name: "Recordatorio 2 horas antes",
    description: "Entrega el enlace de la reunion, 2 horas antes de cada sesion.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 120,
    subject: "Tu sesion de {{curso}} comienza en 2 horas",
    body: `Hola {{nombre}},

Faltan 2 horas para iniciar {{sesion_actual}} de {{curso}}.

Hora: {{horaSesion}}

{{bloqueEnlace}}

R.A. Training`,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_15m",
    name: "Recordatorio 15 minutos antes",
    description: "Incluye el enlace directo justo antes de empezar.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 15,
    subject: "Empezamos en 15 minutos - {{curso}}",
    body: `Hola {{nombre}},

{{sesion_actual}} de {{curso}} comienza en 15 minutos.

Enlace de acceso:
{{link_reunion}}

Te recomendamos entrar ahora para verificar tu audio y conexion.

R.A. Training`,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "session_live",
    name: "Sesion en vivo",
    description: "Aviso al comenzar cada sesion.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 0,
    subject: "{{curso}} ya esta en vivo",
    body: `Hola {{nombre}},

{{sesion_actual}} de {{curso}} ya esta comenzando.

Ingresa aqui:
{{link_reunion}}

R.A. Training`,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "late_access",
    name: "Acceso para rezagados",
    description: "Reenvia el enlace unos minutos despues del inicio.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 20,
    subject: "Aun puedes ingresar a {{curso}}",
    body: `Hola {{nombre}},

Si aun no ingresaste a {{sesion_actual}} de {{curso}}, puedes usar este enlace:

{{link_reunion}}

R.A. Training`,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "thank_you",
    name: "Fin de sesion",
    description: "Cierra la ultima sesion y confirma el fin del curso.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 5,
    subject: "Finalizamos {{curso}}",
    body: `Hola {{nombre}},

Finalizamos {{curso}}.

Gracias por participar en esta capacitacion. Conservaremos tu registro en el CRM y no enviaremos mas mensajes automaticos de este curso cuando quede cerrado.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "course_complete",
    name: "Curso completo",
    description: "Entrega el enlace informativo del curso completo.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 60,
    subject: "Material de {{curso}}",
    body: `Hola {{nombre}},

Puedes revisar la informacion del curso completo aqui:
{{link_curso_completo}}

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "course_follow_up",
    name: "Seguimiento del curso",
    description: "Seguimiento breve posterior al cierre.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 25 * 60,
    subject: "Seguimiento de {{curso}}",
    body: `Hola {{nombre}},

Gracias nuevamente por participar en {{curso}}.

Si necesitas apoyo adicional, responde a este correo y nuestro equipo te orientara.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "survey",
    name: "Encuesta final",
    description: "Solicita la encuesta final configurada en el curso.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 48 * 60,
    subject: "Encuesta final de {{curso}}",
    body: `Hola {{nombre}},

Tu opinion nos ayuda a mejorar.

Completa la encuesta final de {{curso}} aqui:
{{link_encuesta}}

Gracias por confiar en R.A. Training.`,
    requiresStreamUrl: false,
    requiresSurveyUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
];

export const AUTOMATION_PLAN_LABELS: Record<AutomationPlanKey, string> = {
  welcome: "Bienvenida inmediata",
  whatsapp_group: "Grupo de WhatsApp",
  reminder_24h: "Recordatorio 24 horas antes",
  reminder_2h: "Recordatorio 2 horas antes",
  reminder_15m: "Recordatorio 15 minutos antes",
  session_live: "Sesion en vivo",
  late_access: "Acceso para rezagados",
  course_complete: "Curso completo",
  course_follow_up: "Seguimiento del curso",
  survey: "Encuesta final",
  thank_you: "Fin de sesion",
};
