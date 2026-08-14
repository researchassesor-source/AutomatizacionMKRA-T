import { businessRequest } from "./client";

export type TikTokBusinessProfile = {
  businessId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export async function getBusinessProfile(accessToken: string, businessId: string, fetcher: typeof fetch = fetch) {
  const result = await businessRequest<{ display_name?: string; username?: string; profile_image?: string }>({
    path: "/business/get/",
    accessToken,
    query: { business_id: businessId, fields: JSON.stringify(["display_name", "profile_image", "username"]) },
    fetcher,
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: {
      businessId,
      displayName: result.data.display_name?.trim() || null,
      username: result.data.username?.trim() || null,
      avatarUrl: result.data.profile_image?.trim() || null,
    },
    requestId: result.requestId,
  };
}

export type VideoSettings = {
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSeconds: number | null;
};

export async function getVideoSettings(accessToken: string, businessId: string, fetcher: typeof fetch = fetch) {
  const result = await businessRequest<{
    comment_disabled?: boolean;
    duet_disabled?: boolean;
    stitch_disabled?: boolean;
    max_video_post_duration_sec?: number;
  }>({
    path: "/business/video/settings/",
    accessToken,
    query: { business_id: businessId },
    fetcher,
  });
  if (!result.ok) return result;
  return {
    ok: true as const,
    data: {
      commentDisabled: Boolean(result.data.comment_disabled),
      duetDisabled: Boolean(result.data.duet_disabled),
      stitchDisabled: Boolean(result.data.stitch_disabled),
      maxDurationSeconds: Number.isFinite(result.data.max_video_post_duration_sec)
        ? Number(result.data.max_video_post_duration_sec)
        : null,
    },
    requestId: result.requestId,
  };
}

export async function publishVideo(input: {
  accessToken: string;
  businessId: string;
  videoUrl: string;
  caption: string;
  settings: VideoSettings;
  fetcher?: typeof fetch;
}) {
  const result = await businessRequest<{ share_id?: string }>({
    path: "/business/video/publish/",
    method: "POST",
    accessToken: input.accessToken,
    body: {
      business_id: input.businessId,
      video_url: input.videoUrl,
      post_info: {
        caption: input.caption,
        disable_comment: input.settings.commentDisabled,
        disable_duet: input.settings.duetDisabled,
        disable_stitch: input.settings.stitchDisabled,
      },
    },
    fetcher: input.fetcher,
  });
  if (!result.ok) return result;
  const publishId = result.data.share_id?.trim();
  return publishId
    ? { ok: true as const, publishId, requestId: result.requestId }
    : { ok: false as const, errorCode: "MISSING_PUBLISH_ID", error: "TikTok Business aceptó el video sin identificador de proceso.", requestId: result.requestId };
}

export type PublishStatus = "PROCESSING_DOWNLOAD" | "PUBLISH_COMPLETE" | "FAILED" | "SEND_TO_USER_INBOX" | string;

export async function getPublishStatus(
  accessToken: string,
  businessId: string,
  publishId: string,
  fetcher: typeof fetch = fetch,
) {
  return businessRequest<{ status?: PublishStatus; post_ids?: string[]; reason?: string }>({
    path: "/business/publish/status/",
    accessToken,
    query: { business_id: businessId, publish_id: publishId },
    fetcher,
  });
}
