export const SOCIAL_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export const MAX_SOCIAL_VIDEO_BYTES = 100 * 1024 * 1024;

export type SocialMediaType = "IMAGE" | "VIDEO";

export function inferSocialMediaType(mediaUrl?: string | null): SocialMediaType | null {
  if (!mediaUrl) return null;
  return /\.(mp4|mov|m4v|webm)(?:\?|$)/i.test(mediaUrl) ? "VIDEO" : "IMAGE";
}

export function isSupportedSocialVideo(file: { type: string; size: number }): string | null {
  if (file.size <= 0) return "El video está vacío. Elige otro archivo.";
  if (!SOCIAL_VIDEO_MIME_TYPES.includes(file.type as (typeof SOCIAL_VIDEO_MIME_TYPES)[number])) {
    return "El formato no es compatible. Usa MP4, MOV o WebM.";
  }
  if (file.size > MAX_SOCIAL_VIDEO_BYTES) return "El video supera el límite de 100 MB.";
  return null;
}

export function isPublicSocialMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
