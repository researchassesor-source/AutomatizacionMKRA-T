import type { AutomationTrigger, EnrollmentStatus } from "@prisma/client";

/**
 * Plan estandar de correos solicitado por el negocio.
 *
 * Son valores iniciales: una vez aplicados a un curso quedan como reglas
 * normales y se editan desde /admin/automatizaciones. `planKey` evita que
 * reaplicar el plan duplique reglas.
 */
export type AutomationPlanKey =
  | "welcome"
  | "reminder_24h"
  | "reminder_2h"
  | "reminder_15m"
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
  enrollmentStatuses: EnrollmentStatus[];
};

const AUDIENCE: EnrollmentStatus[] = ["INTERESADO", "INSCRITO", "EN_CURSO"];

export const DEFAULT_AUTOMATION_PLAN: readonly AutomationPlanEntry[] = [
  {
    planKey: "welcome",
    name: "Bienvenida inmediata",
    description: "Se envía apenas se registra la inscripción.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 0,
    subject: "¡Tu inscripción a {{curso}} está confirmada!",
    body: `Hola {{nombre}},

Tu inscripción a {{curso}} fue registrada correctamente.

Fecha: {{fecha}}
Hora: {{hora}}

Te enviaremos recordatorios antes de cada sesión para que tengas a la mano toda la información necesaria.

{{bloqueEnlace}}

Gracias por ser parte de R.A. Training.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_24h",
    name: "Recordatorio 24 horas antes",
    description: "Un recordatorio por cada sesión, 24 horas antes de su inicio.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 24 * 60,
    subject: "Mañana nos vemos en {{curso}}",
    body: `Hola {{nombre}},

Te recordamos que mañana tienes una sesión de {{curso}}.

Fecha: {{fechaSesion}}
Hora: {{horaSesion}}

{{bloqueEnlace}}

Te recomendamos conectarte con unos minutos de anticipación.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_2h",
    name: "Recordatorio 2 horas antes",
    description: "Un recordatorio por cada sesión, 2 horas antes de su inicio.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 120,
    subject: "Tu sesión de {{curso}} comienza en 2 horas",
    body: `Hola {{nombre}},

Faltan 2 horas para iniciar la sesión de {{curso}}.

Hora: {{horaSesion}}

{{bloqueEnlace}}

Ten listo tu dispositivo y una conexión estable.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_15m",
    name: "Recordatorio 15 minutos antes",
    description: "Incluye el enlace directo. Necesita enlace de transmisión configurado.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 15,
    subject: "Empezamos en 15 minutos — ingresa aquí",
    body: `Hola {{nombre}},

La sesión de {{curso}} comienza en 15 minutos.

Ingresa desde este enlace:

{{streamUrl}}

Te recomendamos acceder ahora para verificar tu conexión.

R.A. Training`,
    requiresStreamUrl: true,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "thank_you",
    name: "Agradecimiento final",
    description: "Se envía una hora después de terminar la última sesión.",
    trigger: "AFTER_COURSE",
    offsetMinutes: 60,
    subject: "Gracias por participar en {{curso}}",
    body: `Hola {{nombre}},

Gracias por acompañarnos en {{curso}}.

Esperamos que la experiencia y los contenidos compartidos hayan sido útiles para tu desarrollo.

La información relacionada con certificados, cuando aplique, será comunicada por separado.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: [...AUDIENCE, "COMPLETADO"],
  },
];

export const AUTOMATION_PLAN_LABELS: Record<AutomationPlanKey, string> = {
  welcome: "Bienvenida inmediata",
  reminder_24h: "Recordatorio 24 horas antes",
  reminder_2h: "Recordatorio 2 horas antes",
  reminder_15m: "Recordatorio 15 minutos antes",
  thank_you: "Agradecimiento final",
};
