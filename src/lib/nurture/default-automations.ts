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

/**
 * Donde va el enlace de la reunion.
 *
 * Solo en los dos ultimos correos: el de 2 horas es el que entrega el acceso y
 * el de 15 minutos el que lo repite cuando la sesion esta por empezar. La
 * bienvenida y el recordatorio de 24 horas no lo llevan a proposito, para que
 * el enlace no quede enterrado en un correo viejo del buzon justo cuando hace
 * falta. El agradecimiento final tampoco: la sesion ya termino.
 */

export const DEFAULT_AUTOMATION_PLAN: readonly AutomationPlanEntry[] = [
  {
    planKey: "welcome",
    name: "Bienvenida inmediata",
    description: "Se envía apenas se registra la inscripción.",
    trigger: "ON_REGISTRATION",
    offsetMinutes: 0,
    subject: "Tu inscripción a {{curso}} está confirmada",
    body: `Hola {{nombre}},

Tu inscripción a {{curso}} quedó registrada correctamente.

{{bloqueFecha}}

Te enviaremos un recordatorio el día antes, y el enlace de acceso llegará dos horas antes de la sesión.

Puedes consultar los detalles del curso aquí:
{{courseUrl}}

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

El enlace de acceso te llegará dos horas antes de que empiece, en un correo aparte.

Te recomendamos reservar el horario y revisar tu conexión con anticipación.

R.A. Training`,
    requiresStreamUrl: false,
    enrollmentStatuses: AUDIENCE,
  },
  {
    planKey: "reminder_2h",
    name: "Recordatorio 2 horas antes",
    description: "Entrega el enlace de la reunión, 2 horas antes de cada sesión.",
    trigger: "BEFORE_COURSE",
    offsetMinutes: 120,
    subject: "Tu sesión de {{curso}} comienza en 2 horas · enlace de acceso",
    body: `Hola {{nombre}},

Faltan 2 horas para iniciar la sesión de {{curso}}.

Hora: {{horaSesion}}

{{bloqueEnlace}}

Ten listo tu dispositivo y una conexión estable. Te reenviaremos este enlace 15 minutos antes de empezar.

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
    subject: "Empezamos en 15 minutos · {{curso}}",
    body: `Hola {{nombre}},

La sesión de {{curso}} comienza en 15 minutos.

Enlace de acceso:
{{streamUrl}}

Te recomendamos entrar ahora para verificar tu audio y tu conexión.

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
    subject: "¡Felicitaciones por completar {{curso}}!",
    body: `Hola {{nombre}},

¡Felicitaciones! Completaste {{curso}}.

Gracias por acompañarnos y por el tiempo que dedicaste. Esperamos que los contenidos te resulten útiles en tu trabajo del día a día.

La información sobre el certificado, cuando aplique, te llegará por separado.

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
