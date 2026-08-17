import { z } from "zod";
import { mensajeDeVariablesDesconocidas, variablesDesconocidas } from "@/lib/template-variables";

/**
 * Rechaza un texto con variables que el renderer no resuelve.
 *
 * El renderer deja intacto lo que no reconoce, asi que `{{inventada}}` no
 * revienta el envio: llega al contacto escrito tal cual. Eso es peor que un
 * error, porque nadie se entera hasta que alguien lo lee. Se valida en el
 * servidor y no solo en el formulario.
 */
function sinVariablesDesconocidas(campo: "body" | "subject") {
  return (valor: string | null | undefined, contexto: z.RefinementCtx) => {
    if (!valor) return;
    const desconocidas = variablesDesconocidas(valor);
    if (desconocidas.length === 0) return;
    contexto.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensajeDeVariablesDesconocidas(desconocidas) });
  };
}

export const automationRuleFields = z.object({
  courseId: z.string().min(1),
  campaignId: z.string().nullable().optional(),
  name: z.string().trim().min(3).max(140),
  trigger: z.enum(["ON_REGISTRATION", "BEFORE_COURSE", "AFTER_COURSE"]),
  offsetMinutes: z.coerce.number().int().min(0).max(525_600),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().trim().max(200).nullable().optional().superRefine(sinVariablesDesconocidas("subject")),
  body: z.string().trim().min(5).max(10_000).superRefine(sinVariablesDesconocidas("body")),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  // Marca los recordatorios que no tienen sentido sin enlace de transmisión.
  requiresStreamUrl: z.boolean().default(false),
  enrollmentStatuses: z.array(z.enum(["INTERESADO", "INSCRITO", "EN_CURSO", "COMPLETADO", "CANCELADO"])).min(1).default(["INTERESADO", "INSCRITO"]),
});

export const automationRuleSchema = automationRuleFields.refine(
  (value) => value.channel !== "EMAIL" || Boolean(value.subject),
  { message: "El asunto es obligatorio para correo." },
);
