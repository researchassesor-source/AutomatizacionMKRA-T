import type { PublishInput, PublishResult, SocialAdapter, Platform } from "../types";

const API = "https://open.tiktokapis.com/v2";

/**
 * Adaptador de TikTok (Content Posting API).
 *
 * TikTok solo publica VIDEO. Usa "Direct Post" con PULL_FROM_URL: TikTok
 * descarga el video desde la URL publica (ej. Vercel Blob).
 *
 * Requisitos (ver docs/DESPLIEGUE + guia): app de TikTok for Developers con el
 * scope video.publish, dominio de la URL del video verificado en la app, y el
 * refresh token del creador. Mientras la app no pase la auditoria de TikTok,
 * las publicaciones deben ser privadas (SELF_ONLY).
 *
 * Los access token de TikTok duran 24h, asi que se refrescan en cada uso a
 * partir del refresh token.
 */
export class TikTokAdapter implements SocialAdapter {
  readonly platform: Platform = "TIKTOK";

  constructor(
    private readonly config: {
      clientKey?: string;
      clientSecret?: string;
      refreshToken?: string;
      privacy?: string; // SELF_ONLY | PUBLIC_TO_EVERYONE | ...
    },
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.clientKey &&
        this.config.clientSecret &&
        this.config.refreshToken,
    );
  }

  private async accessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_key: this.config.clientKey!,
      client_secret: this.config.clientSecret!,
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken!,
    });
    const res = await fetch(`${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!data.access_token) {
      throw new Error(
        `TikTok token: ${data.error_description ?? data.error ?? "sin access_token"}`,
      );
    }
    return data.access_token;
  }

  async verifyConnection(): Promise<{ ok: boolean; name?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "credenciales incompletas" };
    }
    try {
      const token = await this.accessToken();
      const res = await fetch(`${API}/user/info/?fields=display_name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        data?: { user?: { display_name?: string } };
        error?: { message?: string; code?: string };
      };
      if (data.error && data.error.code !== "ok") {
        return { ok: false, error: data.error.message ?? "token invalido" };
      }
      return { ok: true, name: data.data?.user?.display_name };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: "TIKTOK: credenciales no configuradas" };
    }
    if (!input.mediaUrl || !/\.(mp4|mov|webm)(\?|$)/i.test(input.mediaUrl)) {
      return { ok: false, error: "TikTok requiere un video (mp4)" };
    }
    try {
      const token = await this.accessToken();
      const res = await fetch(`${API}/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: input.caption.slice(0, 2200),
            privacy_level: this.config.privacy || "SELF_ONLY",
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: input.mediaUrl,
          },
        }),
      });
      const data = (await res.json()) as {
        data?: { publish_id?: string };
        error?: { message?: string; code?: string };
      };
      if (data.error && data.error.code !== "ok") {
        return { ok: false, error: `TikTok: ${data.error.message ?? data.error.code}` };
      }
      const id = data.data?.publish_id;
      if (!id) return { ok: false, error: `TikTok: sin publish_id` };
      return { ok: true, externalPostId: id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
