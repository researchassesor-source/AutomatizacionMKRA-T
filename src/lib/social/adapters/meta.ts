import type { PublishInput, PublishResult, SocialAdapter, Platform } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Adaptador para Instagram y Facebook mediante la Graph API oficial de Meta.
 *
 * Publicar en Instagram es un proceso de 2 pasos:
 *   1) crear un "media container" con la imagen y el caption
 *   2) publicar ese container
 *
 * Requiere una cuenta de Instagram Business/Creator vinculada a una Pagina de
 * Facebook, y un token de acceso con los permisos correspondientes.
 */
export class MetaAdapter implements SocialAdapter {
  readonly platform: Platform;

  constructor(
    platform: "INSTAGRAM" | "FACEBOOK",
    private readonly config: {
      accessToken?: string;
      pageId?: string;
      igUserId?: string;
    },
  ) {
    this.platform = platform;
  }

  isConfigured(): boolean {
    if (!this.config.accessToken) return false;
    return this.platform === "INSTAGRAM"
      ? Boolean(this.config.igUserId)
      : Boolean(this.config.pageId);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { ok: false, error: `${this.platform}: credenciales no configuradas` };
    }
    try {
      return this.platform === "INSTAGRAM"
        ? await this.publishInstagram(input)
        : await this.publishFacebook(input);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async publishInstagram(input: PublishInput): Promise<PublishResult> {
    if (!input.mediaUrl) {
      return { ok: false, error: "Instagram requiere una imagen (mediaUrl)" };
    }
    const { igUserId, accessToken } = this.config;

    // Paso 1: crear el container
    const container = await this.graph(`${igUserId}/media`, {
      image_url: input.mediaUrl,
      caption: input.caption,
      access_token: accessToken!,
    });
    if (!container.id) {
      return { ok: false, error: `IG container: ${JSON.stringify(container)}` };
    }

    // Paso 2: publicar el container
    const published = await this.graph(`${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken!,
    });
    if (!published.id) {
      return { ok: false, error: `IG publish: ${JSON.stringify(published)}` };
    }
    return { ok: true, externalPostId: published.id };
  }

  private async publishFacebook(input: PublishInput): Promise<PublishResult> {
    const { pageId, accessToken } = this.config;
    const params: Record<string, string> = {
      message: input.caption,
      access_token: accessToken!,
    };
    if (input.linkUrl) params.link = input.linkUrl;

    const res = await this.graph(`${pageId}/feed`, params);
    if (!res.id) {
      return { ok: false, error: `FB publish: ${JSON.stringify(res)}` };
    }
    return { ok: true, externalPostId: res.id };
  }

  private async graph(path: string, params: Record<string, string>) {
    const body = new URLSearchParams(params);
    const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
    return (await res.json()) as { id?: string; error?: unknown };
  }
}
