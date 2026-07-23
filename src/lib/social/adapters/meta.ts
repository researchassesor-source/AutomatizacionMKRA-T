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

  /**
   * Verifica que el token y los ids son validos consultando la Graph API.
   * Util para el boton "probar conexion" del panel antes de publicar.
   */
  async verifyConnection(): Promise<{ ok: boolean; name?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: "credenciales incompletas" };
    }
    const id =
      this.platform === "INSTAGRAM" ? this.config.igUserId : this.config.pageId;
    const fields = this.platform === "INSTAGRAM" ? "username" : "name";
    try {
      const url = `${GRAPH}/${id}?fields=${fields}&access_token=${this.config.accessToken}`;
      const res = await fetch(url);
      const data = (await res.json()) as {
        name?: string;
        username?: string;
        error?: { message?: string };
      };
      if (data.error) {
        return { ok: false, error: data.error.message ?? "token invalido" };
      }
      return { ok: true, name: data.name ?? data.username };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
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
      return { ok: false, error: "Instagram requiere una imagen o video (mediaUrl)" };
    }
    const { igUserId, accessToken } = this.config;
    const video = isVideo(input.mediaUrl);

    // Paso 1: crear el container (imagen o Reel de video)
    const container = await this.graph(
      `${igUserId}/media`,
      video
        ? {
            media_type: "REELS",
            video_url: input.mediaUrl,
            caption: input.caption,
            access_token: accessToken!,
          }
        : {
            image_url: input.mediaUrl,
            caption: input.caption,
            access_token: accessToken!,
          },
    );
    if (!container.id) {
      const msg = errText(container) ?? JSON.stringify(container);
      return { ok: false, error: `IG container: ${msg}` };
    }

    // Paso 2: esperar a que Instagram procese el media antes de publicar.
    // Las imagenes quedan listas casi al instante; los videos tardan mas.
    const ready = await this.waitForContainer(
      container.id,
      accessToken!,
      video ? 20 : 8,
    );
    if (!ready.ok) return { ok: false, error: ready.error! };

    // Paso 3: publicar el container
    const published = await this.graph(`${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken!,
    });
    if (!published.id) {
      const msg = errText(published) ?? JSON.stringify(published);
      return { ok: false, error: `IG publish: ${msg}` };
    }
    return { ok: true, externalPostId: published.id };
  }

  /** Sondea el estado del container hasta que quede FINISHED (o falle). */
  private async waitForContainer(
    containerId: string,
    token: string,
    maxIntentos: number,
  ): Promise<{ ok: boolean; error?: string }> {
    for (let i = 0; i < maxIntentos; i++) {
      const url = `${GRAPH}/${containerId}?fields=status_code,status&access_token=${token}`;
      const data = (await (await fetch(url)).json()) as {
        status_code?: string;
        status?: string;
      };
      if (data.status_code === "FINISHED") return { ok: true };
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
        return {
          ok: false,
          error: `IG media ${data.status_code}: ${data.status ?? "revisa formato/proporcion de la imagen o video"}`,
        };
      }
      await sleep(2500);
    }
    return {
      ok: false,
      error: "IG: el contenido no quedo listo a tiempo, intenta de nuevo",
    };
  }

  private async publishFacebook(input: PublishInput): Promise<PublishResult> {
    const { pageId, accessToken } = this.config;
    const caption = input.linkUrl
      ? `${input.caption}\n\n${input.linkUrl}`
      : input.caption;

    // Video -> /videos ; imagen -> /photos ; solo texto -> /feed
    if (input.mediaUrl && isVideo(input.mediaUrl)) {
      const res = await this.graph(`${pageId}/videos`, {
        file_url: input.mediaUrl,
        description: caption,
        access_token: accessToken!,
      });
      if (!res.id) {
        return { ok: false, error: `FB video: ${errText(res) ?? JSON.stringify(res)}` };
      }
      return { ok: true, externalPostId: res.id };
    }

    if (input.mediaUrl) {
      const res = await this.graph(`${pageId}/photos`, {
        url: input.mediaUrl,
        caption,
        access_token: accessToken!,
      });
      const id = res.post_id ?? res.id;
      if (!id) return { ok: false, error: `FB photo: ${errText(res) ?? JSON.stringify(res)}` };
      return { ok: true, externalPostId: id };
    }

    const params: Record<string, string> = {
      message: input.caption,
      access_token: accessToken!,
    };
    if (input.linkUrl) params.link = input.linkUrl;

    const res = await this.graph(`${pageId}/feed`, params);
    if (!res.id) {
      return { ok: false, error: `FB publish: ${errText(res) ?? JSON.stringify(res)}` };
    }
    return { ok: true, externalPostId: res.id };
  }

  private async graph(path: string, params: Record<string, string>) {
    const body = new URLSearchParams(params);
    const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
    return (await res.json()) as {
      id?: string;
      post_id?: string;
      error?: { message?: string };
    };
  }
}

function isVideo(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
}

function errText(res: { error?: { message?: string } }): string | undefined {
  return res.error?.message;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
