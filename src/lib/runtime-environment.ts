export function isPreviewDeployment(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function mustSimulateExternalIntegration(mode: string | undefined): boolean {
  return isPreviewDeployment() || process.env.NODE_ENV !== "production" || mode !== "live";
}
