export type LegacyConfigurationState = "DISABLED" | "EXPLICITLY_ENABLED" | "IMPLICITLY_ENABLED" | "NOT_CONFIGURED";

export function legacyConfigurationState(env: NodeJS.ProcessEnv = process.env): LegacyConfigurationState {
  const flag = env.ADMIN_LEGACY_LOGIN_ENABLED?.trim().toLowerCase();
  const passwordConfigured = Boolean(env.ADMIN_PASSWORD);
  if (flag && !["1", "true", "yes", "on", "si", "sí"].includes(flag)) return "DISABLED";
  if (!passwordConfigured) return "NOT_CONFIGURED";
  return flag ? "EXPLICITLY_ENABLED" : "IMPLICITLY_ENABLED";
}

export function canRecommendLegacyDisable(input: { state: LegacyConfigurationState; activeAdmins: number; recentLegacyLogins: number }) {
  return input.state !== "DISABLED" && input.state !== "NOT_CONFIGURED" && input.activeAdmins > 0 && input.recentLegacyLogins === 0;
}
