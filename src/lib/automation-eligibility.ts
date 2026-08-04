import type { AutomationTrigger, MessageChannel } from "@prisma/client";

export type AutomationCourseState = {
  isPublished: boolean;
  acceptsRegistrations: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type AutomationRuleState = {
  trigger: AutomationTrigger;
  channel: MessageChannel;
  subject: string | null;
  body: string;
};

export function courseAcceptsAutomations(course: Pick<AutomationCourseState, "isPublished" | "acceptsRegistrations">) {
  return course.isPublished && course.acceptsRegistrations;
}

export function automationRuleCanRun(course: AutomationCourseState, rule: AutomationRuleState) {
  if (!courseAcceptsAutomations(course) || !rule.body.trim()) return false;
  if (rule.channel === "EMAIL" && !rule.subject?.trim()) return false;
  if (rule.trigger === "BEFORE_COURSE" && !course.startsAt) return false;
  if (rule.trigger === "AFTER_COURSE" && !(course.endsAt ?? course.startsAt)) return false;
  return true;
}
