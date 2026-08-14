import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto/token-cipher";
import {
  hasRequiredTikTokBusinessScopes,
  isApprovedTikTokBusinessMediaUrl,
  resolveTikTokBusinessConfig,
} from "./config";
import { createOAuthState, exchangeCodeForTokens, refreshTokens, verifyOAuthState } from "./oauth";
import { getPublishStatus, publishVideo } from "./publish";

const KEY = Buffer.alloc(32, 7);

afterEach(() => vi.unstubAllEnvs());

describe("configuración fail-closed", () => {
  it("queda disabled sin credenciales ni llamadas implícitas", () => {
    expect(resolveTikTokBusinessConfig({}).mode).toBe("disabled");
    expect(resolveTikTokBusinessConfig({}).reason).toContain("pendiente");
  });

  it("bloquea live sin LIVE_FROM", () => {
    const config = resolveTikTokBusinessConfig({
      TIKTOK_BUSINESS_MODE: "live",
      TIKTOK_BUSINESS_APP_ID: "app",
      TIKTOK_BUSINESS_SECRET: "secret",
      TIKTOK_BUSINESS_ACCOUNT_REDIRECT_URI: "https://example.com/account/callback/",
      TIKTOK_BUSINESS_ADVERTISER_REDIRECT_URI: "https://example.com/advertiser/callback/",
      TIKTOK_BUSINESS_OAUTH_STATE_SECRET: "x".repeat(32),
      TIKTOK_BUSINESS_TOKEN_ENCRYPTION_KEY: KEY.toString("hex"),
    });
    expect(config.reason).toContain("LIVE_FROM");
  });

  it("solo acepta scopes completos y videos del Blob público autorizado", () => {
    expect(hasRequiredTikTokBusinessScopes(["user.info.basic", "video.list", "video.publish"])).toBe(true);
    expect(hasRequiredTikTokBusinessScopes(["user.info.basic"])).toBe(false);
    expect(isApprovedTikTokBusinessMediaUrl("https://store.public.blob.vercel-storage.com/video.mp4")).toBe(true);
    expect(isApprovedTikTokBusinessMediaUrl("https://example.com/video.mp4")).toBe(false);
    expect(isApprovedTikTokBusinessMediaUrl("http://store.public.blob.vercel-storage.com/video.mp4")).toBe(false);
  });
});

describe("OAuth Business", () => {
  it("acepta state firmado, ligado a cookie/admin y rechaza alteraciones", () => {
    const secret = "s".repeat(32);
    const { state } = createOAuthState("admin-1", secret, 1_000);
    expect(verifyOAuthState(state, state, secret, "admin-1", 2_000).ok).toBe(true);
    expect(verifyOAuthState(`${state}x`, state, secret, "admin-1", 2_000).ok).toBe(false);
    expect(verifyOAuthState(state, state, secret, "admin-2", 2_000).ok).toBe(false);
    expect(verifyOAuthState(state, state, secret, "admin-1", 700_000).ok).toBe(false);
  });

  it("intercambia y refresca con JSON Business en nivel superior", async () => {
    const config = resolveTikTokBusinessConfig({
      TIKTOK_BUSINESS_MODE: "live", TIKTOK_BUSINESS_APP_ID: "app-id", TIKTOK_BUSINESS_SECRET: "app-secret",
      TIKTOK_BUSINESS_ACCOUNT_REDIRECT_URI: "https://example.com/account/callback/",
      TIKTOK_BUSINESS_ADVERTISER_REDIRECT_URI: "https://example.com/advertiser/callback/",
      TIKTOK_BUSINESS_OAUTH_STATE_SECRET: "s".repeat(32), TIKTOK_BUSINESS_TOKEN_ENCRYPTION_KEY: KEY.toString("hex"),
      TIKTOK_BUSINESS_LIVE_FROM: "2026-01-01T00:00:00Z",
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, message: "OK", data: {
      access_token: "access-secret", refresh_token: "refresh-secret", open_id: "business-1",
      scope: "user.info.basic,video.list,video.publish", expires_in: 3600, refresh_token_expires_in: 7200,
    } }), { status: 200 })) as unknown as typeof fetch;
    const exchanged = await exchangeCodeForTokens(config, "auth-code", fetcher, 0);
    expect(exchanged.ok).toBe(true);
    const firstBody = JSON.parse(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    expect(firstBody).toMatchObject({ client_id: "app-id", client_secret: "app-secret", auth_code: "auth-code", grant_type: "authorization_code" });
    expect(firstBody.payload).toBeUndefined();
    await refreshTokens(config, "refresh-secret", fetcher, 0);
    const refreshBody = JSON.parse(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1][1]?.body));
    expect(refreshBody).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-secret" });
  });

  it("los tokens se cifran antes de persistirse", () => {
    const cipher = encryptToken("access-secret", KEY);
    expect(cipher).not.toContain("access-secret");
    expect(decryptToken(cipher, KEY)).toBe("access-secret");
  });
});

describe("publicación Business", () => {
  it("guarda share_id como publishId y consulta el estado por separado", async () => {
    const responses = [
      { code: 0, message: "OK", data: { share_id: "publish-1" } },
      { code: 0, message: "OK", data: { status: "PUBLISH_COMPLETE", post_ids: ["post-9"] } },
    ];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })) as unknown as typeof fetch;
    const sent = await publishVideo({ accessToken: "token", businessId: "business-1", videoUrl: "https://store.public.blob.vercel-storage.com/a.mp4", caption: "Hola", settings: { commentDisabled: false, duetDisabled: false, stitchDisabled: false, maxDurationSeconds: null }, fetcher });
    expect(sent).toMatchObject({ ok: true, publishId: "publish-1" });
    const status = await getPublishStatus("token", "business-1", "publish-1", fetcher);
    expect(status).toMatchObject({ ok: true, data: { status: "PUBLISH_COMPLETE", post_ids: ["post-9"] } });
    expect(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0])).toContain("publish_id=publish-1");
  });
});

describe("superficie desplegable", () => {
  it("incluye connect y ambos callbacks sin mezclar el callback legacy", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "src/app/api/integrations/tiktok-business/connect/route.ts"))).toBe(true);
    expect(existsSync(join(root, "src/app/api/integrations/tiktok-business/account/callback/route.ts"))).toBe(true);
    expect(existsSync(join(root, "src/app/api/integrations/tiktok-business/advertiser/callback/route.ts"))).toBe(true);
    const orchestrator = readFileSync(join(root, "src/lib/social/orchestrator.ts"), "utf8");
    expect(orchestrator).toContain("publishId: post.publishId");
    expect(orchestrator).toContain("new TikTokBusinessAdapter");
  });
});
