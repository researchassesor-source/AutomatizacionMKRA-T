import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsableAccessToken: vi.fn(),
  getVideoSettings: vi.fn(),
  publishVideo: vi.fn(),
  getPublishStatus: vi.fn(),
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("./account", () => ({ getUsableAccessToken: mocks.getUsableAccessToken }));
vi.mock("./publish", () => ({
  getVideoSettings: mocks.getVideoSettings,
  publishVideo: mocks.publishVideo,
  getPublishStatus: mocks.getPublishStatus,
}));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { TikTokBusinessAdapter } from "./adapter";

const VIDEO = "https://store.public.blob.vercel-storage.com/video.mp4";

beforeEach(() => {
  vi.stubEnv("TIKTOK_BUSINESS_MODE", "live");
  vi.stubEnv("TIKTOK_BUSINESS_APP_ID", "app");
  vi.stubEnv("TIKTOK_BUSINESS_SECRET", "secret");
  vi.stubEnv("TIKTOK_BUSINESS_ACCOUNT_REDIRECT_URI", "https://example.com/account/callback");
  vi.stubEnv("TIKTOK_BUSINESS_ADVERTISER_REDIRECT_URI", "https://example.com/advertiser/callback");
  vi.stubEnv("TIKTOK_BUSINESS_OAUTH_STATE_SECRET", "s".repeat(32));
  vi.stubEnv("TIKTOK_BUSINESS_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("hex"));
  vi.stubEnv("TIKTOK_BUSINESS_LIVE_FROM", "2026-01-01T00:00:00Z");
  mocks.getUsableAccessToken.mockResolvedValue({ ok: true, accessToken: "token", businessId: "business-1", username: "ra_training" });
  mocks.getVideoSettings.mockResolvedValue({ ok: true, data: { commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxDurationSeconds: 600 } });
  mocks.publishVideo.mockResolvedValue({ ok: true, publishId: "publish-1", requestId: "request-1" });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

function adapter() {
  return new TikTokBusinessAdapter("account-1", "business-1", new Date("2026-08-13T12:00:00Z"));
}

describe("adaptador TikTok Business", () => {
  it("no llama al proveedor cuando está disabled", async () => {
    vi.stubEnv("TIKTOK_BUSINESS_MODE", "disabled");
    const result = await adapter().publish({ caption: "Hola", mediaUrl: VIDEO, mediaType: "VIDEO" });
    expect(result).toMatchObject({ ok: false, errorCode: "TIKTOK_BUSINESS_BLOCKED" });
    expect(mocks.getUsableAccessToken).not.toHaveBeenCalled();
  });

  it("bloquea si la cuenta autorizada no coincide", async () => {
    mocks.getUsableAccessToken.mockResolvedValue({ ok: true, accessToken: "token", businessId: "otra", username: null });
    const result = await adapter().publish({ caption: "Hola", mediaUrl: VIDEO, mediaType: "VIDEO" });
    expect(result).toMatchObject({ ok: false, errorCode: "ACCOUNT_MISMATCH" });
    expect(mocks.publishVideo).not.toHaveBeenCalled();
  });

  it("publica una vez y conserva publishId separado del ID final", async () => {
    const result = await adapter().publish({ caption: "Hola", mediaUrl: VIDEO, mediaType: "VIDEO" });
    expect(result).toMatchObject({ ok: true, accepted: true, publishId: "publish-1", providerStatus: "PROCESSING" });
    expect(result.externalPostId).toBeUndefined();
    expect(mocks.publishVideo).toHaveBeenCalledTimes(1);
  });

  it("si ya existe publishId solo hace polling y nunca republica", async () => {
    mocks.getPublishStatus.mockResolvedValue({ ok: true, data: { status: "PROCESSING_DOWNLOAD" }, requestId: "request-2" });
    const result = await adapter().publish({ caption: "Hola", mediaUrl: VIDEO, mediaType: "VIDEO", publishId: "publish-1" });
    expect(result).toMatchObject({ ok: true, accepted: true, publishId: "publish-1", providerStatus: "PROCESSING" });
    expect(mocks.publishVideo).not.toHaveBeenCalled();
  });

  it("convierte éxito terminal en PUBLIC_COMPLETE con ID público", async () => {
    mocks.getPublishStatus.mockResolvedValue({ ok: true, data: { status: "PUBLISH_COMPLETE", post_ids: ["post-9"] }, requestId: "request-3" });
    const result = await adapter().publish({ caption: "Hola", mediaUrl: VIDEO, mediaType: "VIDEO", publishId: "publish-1" });
    expect(result).toMatchObject({ ok: true, publishId: "publish-1", externalPostId: "post-9", providerStatus: "PUBLISH_COMPLETE" });
  });

  it("conserva publishId ante fallo terminal para impedir republicación", async () => {
    mocks.getPublishStatus.mockResolvedValue({ ok: true, data: { status: "FAILED", reason: "Formato rechazado" }, requestId: "request-4" });
    const result = await adapter().publish({ caption: "Hola", mediaUrl: VIDEO, mediaType: "VIDEO", publishId: "publish-1" });
    expect(result).toMatchObject({ ok: false, publishId: "publish-1", errorCode: "TIKTOK_PUBLISH_FAILED", providerStatus: "FAILED" });
    expect(mocks.publishVideo).not.toHaveBeenCalled();
  });
});
