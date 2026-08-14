import { writeAudit } from "@/lib/audit";
import type { PublishInput, PublishResult, SocialAdapter } from "@/lib/social/types";
import { getUsableAccessToken } from "./account";
import { isApprovedTikTokBusinessMediaUrl, isWithinTikTokBusinessWindow, resolveTikTokBusinessConfig } from "./config";
import { getPublishStatus, getVideoSettings, publishVideo } from "./publish";

function safeStatusReason(value: string | undefined): string {
  return (value || "TikTok Business rechazó la publicación.")
    .replace(/(?:token|secret|authorization|cookie)\s*[:=]\s*\S+/gi, "dato sensible=[oculto]")
    .slice(0, 300);
}

export class TikTokBusinessAdapter implements SocialAdapter {
  readonly platform = "TIKTOK" as const;

  constructor(
    private readonly accountId: string,
    private readonly expectedBusinessId: string,
    private readonly scheduledAt: Date,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return resolveTikTokBusinessConfig().reason === null;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const config = resolveTikTokBusinessConfig();
    if (!isWithinTikTokBusinessWindow(this.scheduledAt, config)) {
      return { ok: false, errorCode: "TIKTOK_BUSINESS_BLOCKED", error: config.reason ?? "La publicación está antes de TIKTOK_BUSINESS_LIVE_FROM." };
    }
    if (input.mediaType !== "VIDEO" || !input.mediaUrl || !isApprovedTikTokBusinessMediaUrl(input.mediaUrl)) {
      return { ok: false, errorCode: "INVALID_MEDIA", error: "TikTok Business solo admite videos del almacenamiento público autorizado del CRM." };
    }
    if (!input.caption.trim() || input.caption.length > 2_200) {
      return { ok: false, errorCode: "INVALID_CAPTION", error: "El texto de TikTok debe tener entre 1 y 2200 caracteres." };
    }
    const access = await getUsableAccessToken(this.accountId, config, this.fetcher);
    if (!access.ok) return { ok: false, errorCode: access.errorCode, error: access.error };
    if (access.businessId !== this.expectedBusinessId) {
      await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_ACCOUNT_MISMATCH", entityType: "SocialAccount", entityId: this.accountId, result: "FAILURE", metadata: { accountMatched: false } });
      return { ok: false, errorCode: "ACCOUNT_MISMATCH", error: "La cuenta autorizada no coincide con la cuenta de la publicación." };
    }

    if (input.publishId) return this.poll(access.accessToken, access.businessId, access.username, input.publishId);

    await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_PUBLICATION_STARTED", entityType: "SocialAccount", entityId: this.accountId, metadata: { mediaType: "VIDEO", accountMatched: true } });
    const settings = await getVideoSettings(access.accessToken, access.businessId, this.fetcher);
    if (!settings.ok) {
      await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_PUBLICATION_FAILED", entityType: "SocialAccount", entityId: this.accountId, result: "FAILURE", metadata: { stage: "settings", errorCode: settings.errorCode } });
      return { ok: false, errorCode: settings.errorCode, error: settings.error };
    }
    const sent = await publishVideo({
      accessToken: access.accessToken,
      businessId: access.businessId,
      videoUrl: input.mediaUrl,
      caption: input.caption,
      settings: settings.data,
      fetcher: this.fetcher,
    });
    if (!sent.ok) {
      await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_PUBLICATION_FAILED", entityType: "SocialAccount", entityId: this.accountId, result: "FAILURE", metadata: { stage: "publish", errorCode: sent.errorCode, requestId: sent.requestId } });
      return { ok: false, errorCode: sent.errorCode, error: sent.error };
    }
    await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_PUBLICATION_ACCEPTED", entityType: "SocialAccount", entityId: this.accountId, metadata: { publishIdPresent: true, requestId: sent.requestId } });
    return {
      ok: true,
      accepted: true,
      publishId: sent.publishId,
      providerStatus: "PROCESSING",
      providerResponse: { channel: "tiktok_business", phase: "PROCESSING", requestId: sent.requestId },
    };
  }

  private async poll(accessToken: string, businessId: string, username: string | null, publishId: string): Promise<PublishResult> {
    const result = await getPublishStatus(accessToken, businessId, publishId, this.fetcher);
    if (!result.ok) {
      if (["TIMEOUT", "NETWORK_ERROR"].includes(result.errorCode)) {
        return { ok: true, accepted: true, publishId, providerStatus: "PROCESSING", providerResponse: { channel: "tiktok_business", phase: "POLL_RETRY", requestId: result.requestId } };
      }
      return { ok: false, publishId, errorCode: result.errorCode, error: result.error, providerStatus: "ERROR" };
    }
    const status = result.data.status ?? "PROCESSING_DOWNLOAD";
    if (status === "PROCESSING_DOWNLOAD" || (status === "PUBLISH_COMPLETE" && !result.data.post_ids?.[0])) {
      return { ok: true, accepted: true, publishId, providerStatus: "PROCESSING", providerResponse: { channel: "tiktok_business", phase: status, requestId: result.requestId } };
    }
    if (status === "PUBLISH_COMPLETE") {
      const externalPostId = result.data.post_ids?.[0];
      if (!externalPostId) return { ok: true, accepted: true, publishId, providerStatus: "PROCESSING" };
      await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_PUBLICATION_COMPLETED", entityType: "SocialAccount", entityId: this.accountId, metadata: { publishIdPresent: true, externalPostIdPresent: true, requestId: result.requestId } });
      return {
        ok: true,
        publishId,
        externalPostId,
        providerPostUrl: username ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(externalPostId)}` : undefined,
        providerStatus: "PUBLISH_COMPLETE",
        providerResponse: { channel: "tiktok_business", phase: "PUBLISH_COMPLETE", requestId: result.requestId },
      };
    }
    const error = status === "FAILED"
      ? safeStatusReason(result.data.reason)
      : "TikTok Business devolvió un estado terminal inesperado.";
    await writeAudit({ actorEmail: "automation", action: "TIKTOK_BUSINESS_PUBLICATION_FAILED", entityType: "SocialAccount", entityId: this.accountId, result: "FAILURE", metadata: { publishIdPresent: true, providerStatus: status, requestId: result.requestId } });
    return { ok: false, publishId, errorCode: status === "FAILED" ? "TIKTOK_PUBLISH_FAILED" : "UNEXPECTED_PROVIDER_STATUS", error, providerStatus: status };
  }
}
