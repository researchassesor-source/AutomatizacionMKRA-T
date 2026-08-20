import type { AutomationTrigger, EnrollmentStatus, MessageChannel } from "@prisma/client";
import { DEFAULT_AUTOMATION_PLAN, type AutomationPlanKey } from "./default-automations";
import { templateFieldsFor, WHATSAPP_AUTOMATION_PLAN } from "./default-automations-whatsapp";

export type PlanChannelEntry = {
  name: string;
  trigger: AutomationTrigger;
  offsetMinutes: number;
  subject: string | null;
  body: string;
  requiresStreamUrl: boolean;
  enrollmentStatuses: EnrollmentStatus[];
  waTemplateName: string | null;
  waTemplateLanguage: string | null;
  waTemplateBodyVars: string[] | null;
  waTemplateUrlVar: string | null;
};

/**
 * Definicion canonica de un (planKey, canal), o `null` si ese canal no tiene
 * plan estandar para ese paso.
 *
 * Unica fuente: DEFAULT_AUTOMATION_PLAN y WHATSAPP_AUTOMATION_PLAN. No
 * duplica asunto, cuerpo ni plantilla; solo los busca y los reordena.
 */
export function planEntryFor(planKey: string, channel: MessageChannel): PlanChannelEntry | null {
  if (channel === "EMAIL") {
    const entry = DEFAULT_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
    if (!entry) return null;
    return {
      name: entry.name,
      trigger: entry.trigger,
      offsetMinutes: entry.offsetMinutes,
      subject: entry.subject,
      body: entry.body,
      requiresStreamUrl: entry.requiresStreamUrl,
      enrollmentStatuses: entry.enrollmentStatuses,
      waTemplateName: null,
      waTemplateLanguage: null,
      waTemplateBodyVars: null,
      waTemplateUrlVar: null,
    };
  }
  const entry = WHATSAPP_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entry) return null;
  return {
    name: entry.name,
    trigger: entry.trigger,
    offsetMinutes: entry.offsetMinutes,
    // WhatsApp no tiene asunto: ver default-automations-whatsapp.ts.
    subject: null,
    body: entry.body,
    requiresStreamUrl: entry.requiresStreamUrl,
    enrollmentStatuses: entry.enrollmentStatuses,
    ...templateFieldsFor(entry),
  };
}

/** Canales con plan estandar definido para ese paso, derivado (no hardcodeado). */
export function availableChannelsFor(planKey: string): MessageChannel[] {
  return (["EMAIL", "WHATSAPP"] as const).filter((channel) => planEntryFor(planKey, channel) !== null);
}

export type { AutomationPlanKey };
