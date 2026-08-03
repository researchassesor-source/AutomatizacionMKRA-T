import type { AutomationTrigger } from "@prisma/client";

export const ECUADOR_TIME_ZONE = "America/Guayaquil";

export type AutomationScheduleInput = {
  trigger: AutomationTrigger;
  offsetMinutes: number;
  registeredAt: Date;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export function calculateAutomationSchedule(input: AutomationScheduleInput): Date | null {
  if (!Number.isInteger(input.offsetMinutes)) return null;
  if (input.trigger === "ON_REGISTRATION") {
    return new Date(input.registeredAt.getTime() + Math.max(0, input.offsetMinutes) * 60_000);
  }
  if (input.trigger === "BEFORE_COURSE") {
    if (!input.startsAt) return null;
    return new Date(input.startsAt.getTime() - Math.abs(input.offsetMinutes) * 60_000);
  }
  const base = input.endsAt ?? input.startsAt;
  if (!base) return null;
  return new Date(base.getTime() + Math.abs(input.offsetMinutes) * 60_000);
}

export function nextFixedRuleExecution(input: Omit<AutomationScheduleInput, "registeredAt">, now = new Date()) {
  if (input.trigger === "ON_REGISTRATION") return null;
  const scheduled = calculateAutomationSchedule({ ...input, registeredAt: now });
  return scheduled && scheduled > now ? scheduled : null;
}

export function supportsEnrollmentStatus(value: unknown, status: string): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((item) => typeof item === "string") && value.includes(status);
}
