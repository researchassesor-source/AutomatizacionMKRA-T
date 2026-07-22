import type { MessageChannel } from "@prisma/client";

// Definicion de una secuencia de nurture como datos.
// Cada paso se programa con un desfase (delayHours) respecto a la inscripcion.
// El cuerpo admite variables {{nombre}}, {{curso}}, {{appUrl}}.

export type SequenceStep = {
  key: string;
  channel: MessageChannel;
  delayHours: number;
  subject?: string;
  body: string;
};

export type Sequence = {
  key: string;
  name: string;
  steps: SequenceStep[];
};

export const welcomeSequence: Sequence = {
  key: "bienvenida",
  name: "Bienvenida a curso gratuito",
  steps: [
    {
      key: "acceso",
      channel: "EMAIL",
      delayHours: 0,
      subject: "¡Bienvenido a RA-Training! Aqui tienes tu acceso",
      body: [
        "Hola {{nombre}},",
        "",
        "Gracias por inscribirte en \"{{curso}}\". Ya tienes tu cupo reservado.",
        "Entra cuando quieras y avanza a tu ritmo:",
        "",
        "{{appUrl}}",
        "",
        "Cualquier duda, responde a este correo. ¡Exitos!",
        "El equipo de RA-Training",
      ].join("\n"),
    },
    {
      key: "recordatorio",
      channel: "EMAIL",
      delayHours: 24,
      subject: "¿Ya empezaste tu curso? Un tip para avanzar",
      body: [
        "Hola {{nombre}},",
        "",
        "Vimos que te inscribiste en \"{{curso}}\". Dedicarle 20 minutos hoy",
        "es suficiente para tomar impulso. ¡Tu yo del futuro te lo agradecera!",
        "",
        "Continua aqui: {{appUrl}}",
        "",
        "El equipo de RA-Training",
      ].join("\n"),
    },
    {
      key: "oferta",
      channel: "EMAIL",
      delayHours: 72,
      subject: "Da el siguiente paso en tu carrera",
      body: [
        "Hola {{nombre}},",
        "",
        "Cuando termines tu curso gratuito, tenemos programas mas completos",
        "para llevar tu perfil al siguiente nivel. Te contamos las opciones",
        "sin compromiso.",
        "",
        "Conoce el catalogo: {{appUrl}}",
        "",
        "El equipo de RA-Training",
      ].join("\n"),
    },
  ],
};

export const sequences: Record<string, Sequence> = {
  [welcomeSequence.key]: welcomeSequence,
};
