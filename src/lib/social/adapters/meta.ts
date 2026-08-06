import { DEFAULT_GRAPH_API_VERSION, describeMetaError, type MetaConfig } from "../meta-config";
import type { PublishInput, PublishResult, SocialAdapter, Platform } from "../types";

type GraphError = { code?: number; error_subcode?: number; message?: string; type?: string };
type GraphResponse = { id?: string; post_id?: string; status_code?: string; status?: string; error?: GraphError };

/**
 * Adaptador para Instagram y Facebook mediante la Graph API oficial de Meta.
 *
 * Publicar en Instagram es un proceso de 2 pasos:
 *   1) crear un "media container" con la imagen y el caption
 *   2) publicar ese container con media_publish
 *
 * Requiere una cuenta de Instagram Business/Creator vinculada a una Pagina de
 * Facebook, y un token con los permisos correspondientes. El token viaja
 * siempre en la cabecera Authorization, nunca en la query string.
 */
export class MetaAdapter implements SocialAdapter {
  readonly platform: Platform;
  private readonly graph: string;

  constructor(
    platform: "INSTAGRAM" | "FACEBOOK",
    private readonly config: MetaConfig,
  ) {
    this.platform = platform;
    this.graph = `https://graph.facebook.com/${config.graphVersion ?? DEFAULT_GRAPH_API_VERSION}`;
  }

  isConfigured(): boolean {
    if (!this.config.accessToken) return false;
    return this.platform === "INSTAGRAM"
      ? Boolean(this.config.igUserId)
      : Boolean(this.config.pageId);
  }

  /**
   * Comprueba credenciales e identidades antes de publicar. En Facebook
   * confirma ademas el vinculo con la cuenta de Instagram, que es el punto que
   * mas suele fallar en la configuracion.
   */
  async verifyConnection(): Promise<{ ok: boolean; name?: string; details?: Record<string, string | boolean>; errorCode?: string; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, errorCode: "NOT_CONFIGURED", error: "Faltan el token del usuario del sistema o el identificador de la cuenta." };
    }
    try {
      if (this.platform === "INSTAGRAM") {
        const data = await this.get(`${this.config.igUserId}?fields=id,username`);
        if (data.error) return { ok: false, ...describeMetaError(data.error) };
        const account = data as GraphResponse & { username?: string };
        return { ok: true, name: account.username, details: { instagramAccountId: String(account.id ?? "") } };
      }
      const page = await this.get(`${this.config.pageId}?fields=id,name,instagram_business_account`);
      if (page.error) return { ok: false, ...describeMetaError(page.error) };
      const typed = page as GraphResponse & { name?: string; instagram_business_account?: { id?: string } };
      const linkedInstagram = typed.instagram_business_account?.id ?? null;
      return {
        ok: true,
        name: typed.name,
        details: {
          pageId: String(typed.id ?? ""),
          instagramLinked: Boolean(linkedInstagram),
          instagramMatchesConfig: Boolean(linkedInstagram && linkedInstagram === this.config.igUserId),
        },
      };
    } catch {
      return { ok: false, errorCode: "NETWORK_ERROR", error: "No se pudo contactar a Meta." };
    }
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { ok: false, errorCode: "NOT_CONFIGURED", error: `${this.platform}: faltan credenciales o identificadores de Meta.` };
    }
    if (input.mediaUrl && !isPublicHttpsUrl(input.mediaUrl)) {
      return { ok: false, errorCode: "MEDIA_NOT_PUBLIC", error: "La imagen no está disponible mediante una URL pública HTTPS." };
    }
    try {
      return this.platform === "INSTAGRAM"
        ? await this.publishInstagram(input)
        : await this.publishFacebook(input);
    } catch {
      return { ok: false, errorCode: "NETWORK_ERROR", error: "No se pudo contactar a Meta." };
    }
  }

  private async publishInstagram(input: PublishInput): Promise<PublishResult> {
    if (!input.mediaUrl) {
      return { ok: false, errorCode: "MEDIA_REQUIRED", error: "Instagram necesita una imagen o un video para publicar." };
    }
    const { igUserId } = this.config;
    const video = isVideo(input.mediaUrl);
    const caption = input.linkUrl ? `${input.caption}\n\n${input.linkUrl}` : input.caption;

    // Paso 1: crear el container (imagen o Reel de video).
    const container = await this.post(
      `${igUserId}/media`,
      video
        ? { media_type: "REELS", video_url: input.mediaUrl, caption }
        : { image_url: input.mediaUrl, caption },
    );
    if (!container.id) {
      return { ok: false, ...describeMetaError(container.error), providerResponse: { step: "container", metaCode: container.error?.code ?? null } };
    }

    // Paso 2: esperar a que Instagram procese el media. Las imagenes quedan
    // listas casi al instante; los videos tardan mas.
    const ready = await this.waitForContainer(container.id, video ? 20 : 8);
    if (!ready.ok) {
      return { ok: false, errorCode: ready.errorCode, error: ready.error, providerResponse: { step: "container_status", containerId: container.id } };
    }

    // Paso 3: publicar el container.
    const published = await this.post(`${igUserId}/media_publish`, { creation_id: container.id });
    if (!published.id) {
      return { ok: false, ...describeMetaError(published.error), providerResponse: { step: "publish", containerId: container.id, metaCode: published.error?.code ?? null } };
    }
    // Instagram devuelve el media id, no el shortcode publico: no se construye
    // una URL adivinada que luego seria un enlace roto en el panel.
    return {
      ok: true,
      externalPostId: published.id,
      providerResponse: { platform: "INSTAGRAM", containerId: container.id, mediaId: published.id },
    };
  }

  /** Sondea el estado del container hasta que quede FINISHED (o falle). */
  private async waitForContainer(containerId: string, maxAttempts: number): Promise<{ ok: boolean; errorCode?: string; error?: string }> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const data = await this.get(`${containerId}?fields=status_code,status`);
      if (data.status_code === "FINISHED") return { ok: true };
      if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
        return { ok: false, errorCode: `IG_${data.status_code}`, error: "Instagram rechazó el contenido. Revisa el formato y la proporción de la imagen o el video." };
      }
      await sleep(2500);
    }
    return { ok: false, errorCode: "IG_PROCESSING", error: "Instagram todavía está procesando el contenido. Reintenta en unos minutos." };
  }

  private async publishFacebook(input: PublishInput): Promise<PublishResult> {
    const { pageId } = this.config;
    const caption = input.linkUrl ? `${input.caption}\n\n${input.linkUrl}` : input.caption;

    // Video -> /videos ; imagen -> /photos ; solo texto -> /feed
    if (input.mediaUrl && isVideo(input.mediaUrl)) {
      const res = await this.post(`${pageId}/videos`, { file_url: input.mediaUrl, description: caption });
      if (!res.id) return { ok: false, ...describeMetaError(res.error), providerResponse: { step: "video", metaCode: res.error?.code ?? null } };
      return { ok: true, externalPostId: res.id, providerResponse: { platform: "FACEBOOK", kind: "video" } };
    }

    if (input.mediaUrl) {
      const res = await this.post(`${pageId}/photos`, { url: input.mediaUrl, caption });
      const id = res.post_id ?? res.id;
      if (!id) return { ok: false, ...describeMetaError(res.error), providerResponse: { step: "photo", metaCode: res.error?.code ?? null } };
      return { ok: true, externalPostId: id, providerPostUrl: `https://www.facebook.com/${id}`, providerResponse: { platform: "FACEBOOK", kind: "photo" } };
    }

    const params: Record<string, string> = { message: input.caption };
    if (input.linkUrl) params.link = input.linkUrl;
    const res = await this.post(`${pageId}/feed`, params);
    if (!res.id) return { ok: false, ...describeMetaError(res.error), providerResponse: { step: "feed", metaCode: res.error?.code ?? null } };
    return { ok: true, externalPostId: res.id, providerPostUrl: `https://www.facebook.com/${res.id}`, providerResponse: { platform: "FACEBOOK", kind: "feed" } };
  }

  private async get(path: string): Promise<GraphResponse> {
    const res = await fetch(`${this.graph}/${path}`, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });
    return (await res.json().catch(() => ({}))) as GraphResponse;
  }

  private async post(path: string, params: Record<string, string>): Promise<GraphResponse> {
    const res = await fetch(`${this.graph}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
      body: new URLSearchParams(params),
    });
    return (await res.json().catch(() => ({}))) as GraphResponse;
  }
}

function isVideo(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
}

/** Meta descarga el archivo por su cuenta: debe ser HTTPS y alcanzable. */
export function isPublicHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
