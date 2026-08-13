import { describe, expect, it } from "vitest";
import { inferSocialMediaType, isPublicSocialMediaUrl, isSupportedSocialVideo, MAX_SOCIAL_VIDEO_BYTES } from "./media";

describe("multimedia social", () => {
  it("mantiene compatibles las imágenes históricas y reconoce video", () => {
    expect(inferSocialMediaType("https://blob.example.com/historica.jpg")).toBe("IMAGE");
    expect(inferSocialMediaType("https://blob.example.com/reel.mp4?download=1")).toBe("VIDEO");
    expect(inferSocialMediaType(null)).toBeNull();
  });

  it("rechaza videos vacíos, formatos ajenos y archivos sobre el límite", () => {
    expect(isSupportedSocialVideo({ type: "video/mp4", size: 0 })).toContain("vacío");
    expect(isSupportedSocialVideo({ type: "video/avi", size: 100 })).toContain("MP4");
    expect(isSupportedSocialVideo({ type: "video/mp4", size: MAX_SOCIAL_VIDEO_BYTES + 1 })).toContain("100 MB");
    expect(isSupportedSocialVideo({ type: "video/mp4", size: 1024 })).toBeNull();
  });

  it("solo admite URLs públicas HTTPS", () => {
    expect(isPublicSocialMediaUrl("https://blob.example.com/video.mp4")).toBe(true);
    expect(isPublicSocialMediaUrl("http://blob.example.com/video.mp4")).toBe(false);
    expect(isPublicSocialMediaUrl("https://localhost/video.mp4")).toBe(false);
  });
});
