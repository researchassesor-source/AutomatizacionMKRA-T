import { z } from "zod";

/**
 * El enlace de transmision es configurable desde el CRM y puede repetirse entre
 * sesiones. Se exige HTTPS para no enviar a los participantes un enlace inseguro,
 * pero no se restringe el proveedor (Zoom, Meet, Teams, YouTube, etc.).
 */
export function isValidStreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.hostname.endsWith(".local");
  } catch {
    return false;
  }
}

const optionalStreamUrl = z
  .string()
  .trim()
  .max(2000, "El enlace es demasiado largo.")
  .optional()
  .or(z.literal(""))
  .refine((value) => !value || isValidStreamUrl(value), "El enlace de transmisión debe ser una URL https válida.");

export const courseSessionSchema = z
  .object({
    title: z.string().trim().max(160, "El título es demasiado largo.").optional().or(z.literal("")),
    startAt: z.string().datetime({ message: "La fecha de inicio no es válida." }),
    endAt: z.union([z.literal(""), z.string().datetime({ message: "La fecha de cierre no es válida." })]).optional(),
    streamUrl: optionalStreamUrl,
  })
  .superRefine((data, context) => {
    if (data.endAt && new Date(data.endAt) <= new Date(data.startAt)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "La hora de cierre debe ser posterior a la de inicio." });
    }
  });

export const courseStreamUrlSchema = z.object({ streamUrl: optionalStreamUrl });

export function courseSessionData(input: z.infer<typeof courseSessionSchema>) {
  return {
    title: input.title || null,
    startAt: new Date(input.startAt),
    endAt: input.endAt ? new Date(input.endAt) : null,
    streamUrl: input.streamUrl || null,
  };
}
