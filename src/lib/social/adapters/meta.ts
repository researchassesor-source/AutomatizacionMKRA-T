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
  /**
   * Identificador de la cuenta concreta a la que se publica.
   *
   * Antes el adaptador solo miraba `META_PAGE_ID`, de modo que elegir una
   * pagina u otra en el panel no cambiaba nada: todo salia siempre a la que
   * dijera la variable. Quien publicaba creia estar eligiendo destino y no lo
   * estaba. Ahora manda la cuenta seleccionada y la variable queda como
   * respaldo para instalaciones que aun no tengan `externalId` guardado.
   */
  private readonly targetId?: string;

  constructor(
    platform: "INSTAGRAM" | "FACEBOOK",
    private readonly config: MetaConfig,
    targetId?: string | null,
  ) {
    this.platform = platform;
    this.graph = `https://graph.facebook.com/${config.graphVersion ?? DEFAULT_GRAPH_API_VERSION}`;
    this.targetId = normalizeAccountId(targetId) ?? undefined;
  }

  /** Pagina de Facebook a la que se publica. */
  private get pageId(): string | undefined {
    return this.platform === "FACEBOOK" ? (this.targetId ?? this.config.pageId) : this.config.pageId;
  }

  /** Cuenta de Instagram a la que se publica. */
  private get igUserId(): string | undefined {
    return this.platform === "INSTAGRAM" ? (this.targetId ?? this.config.igUserId) : this.config.igUserId;
  }

  isConfigured(): boolean {
    if (!this.config.accessToken) return false;
    return this.platform === "INSTAGRAM" ? Boolean(this.igUserId) : Boolean(this.pageId);
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
        const data = await this.get(`${this.igUserId}?fields=id,username`);
        if (data.error) return { ok: false, ...describeMetaError(data.error) };
        const account = data as GraphResponse & { username?: string };
        return { ok: true, name: account.username, details: { instagramAccountId: String(account.id ?? "") } };
      }
      const page = await this.get(`${this.pageId}?fields=id,name,instagram_business_account`);
      if (page.error) return { ok: false, ...describeMetaError(page.error) };
      const typed = page as GraphResponse & { name?: string; instagram_business_account?: { id?: string } };
      const linkedInstagram = typed.instagram_business_account?.id ?? null;
      // Leer la pagina NO prueba que se pueda publicar en ella: son permisos
      // distintos. Por eso se comprueba tambien la capacidad de publicacion;
      // sin esto el panel decia "Listo" y la publicacion fallaba igualmente.
      const publicacion = await this.checkPublishCapability();
      return {
        ok: publicacion.puedePublicar,
        name: typed.name,
        errorCode: publicacion.puedePublicar ? undefined : "FB_SIN_PERMISO_PUBLICAR",
        error: publicacion.puedePublicar ? undefined : publicacion.motivo,
        details: {
          pageId: String(typed.id ?? ""),
          instagramLinked: Boolean(linkedInstagram),
          instagramMatchesConfig: Boolean(linkedInstagram && linkedInstagram === this.igUserId),
          puedePublicar: publicacion.puedePublicar,
          tareasSobreLaPagina: publicacion.tareas.join(", ") || "(ninguna)",
          tokenDePaginaDisponible: publicacion.tokenDePaginaDisponible,
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

  /**
   * ¿Puede este token publicar en la pagina, o solo leerla?
   *
   * Meta responde con el mismo `code: 200` tanto si al token le faltan
   * permisos como si al usuario del sistema no le han asignado la pagina. Esta
   * comprobacion separa ambos casos ANTES de intentar publicar, mirando dos
   * cosas que no requieren escribir nada: las tareas que se tienen sobre la
   * pagina y si se puede derivar un token de pagina.
   */
  private async checkPublishCapability(): Promise<{
    puedePublicar: boolean;
    tareas: string[];
    tokenDePaginaDisponible: boolean;
    motivo?: string;
  }> {
    const data = await this.get(`${this.pageId}?fields=tasks,access_token`);
    const typed = data as GraphResponse & { tasks?: string[]; access_token?: string };
    const tareas = typed.tasks ?? [];
    const tokenDePaginaDisponible = Boolean(typed.access_token);
    // CREATE_CONTENT es la tarea que Meta exige para publicar en una pagina.
    const puedeCrear = tareas.includes("CREATE_CONTENT");

    if (data.error) {
      return {
        puedePublicar: false,
        tareas,
        tokenDePaginaDisponible,
        motivo: `Meta no permite consultar los permisos sobre esta página: ${data.error.message ?? "sin detalle"}. Suele significar que al token le falta pages_show_list o que la página no está asignada al usuario del sistema.`,
      };
    }
    if (!puedeCrear) {
      return {
        puedePublicar: false,
        tareas,
        tokenDePaginaDisponible,
        motivo: tareas.length === 0
          ? "El usuario del sistema no tiene ninguna tarea asignada sobre esta página. Hay que asignársela en Business Settings con la tarea «Crear contenido»."
          : `El usuario del sistema tiene ${tareas.join(", ")} sobre esta página, pero le falta CREATE_CONTENT, que es la tarea que exige Meta para publicar.`,
      };
    }
    if (!tokenDePaginaDisponible) {
      return {
        puedePublicar: false,
        tareas,
        tokenDePaginaDisponible,
        motivo: "No se puede derivar un token de página. Al token le falta el permiso pages_show_list o pages_read_engagement.",
      };
    }
    return { puedePublicar: true, tareas, tokenDePaginaDisponible };
  }

  /**
   * Diagnostico ampliado para el panel. Nunca devuelve el token ni un fragmento.
   *
   * Existe porque "permisos insuficientes" no le dice a nadie que tiene que
   * cambiar. Esto nombra el permiso o la tarea que falta.
   */
  async diagnose(): Promise<Record<string, unknown>> {
    const identidad = await this.get("me?fields=id,name");
    const capacidad = this.platform === "FACEBOOK"
      ? await this.checkPublishCapability()
      : { puedePublicar: true, tareas: [], tokenDePaginaDisponible: false };
    const permisos = await this.inspectToken();
    return {
      plataforma: this.platform,
      destinoConfigurado: this.platform === "FACEBOOK" ? Boolean(this.pageId) : Boolean(this.igUserId),
      /** De donde sale el destino: de la cuenta elegida o de la variable. */
      origenDelDestino: this.targetId ? "cuenta seleccionada" : "variable de entorno",
      identidadDelToken: identidad.error ? `error: ${identidad.error.message ?? "sin detalle"}` : ((identidad as { name?: string }).name ?? "sin nombre"),
      tokenValido: !identidad.error,
      ...permisos,
      tareasSobreLaPagina: capacidad.tareas,
      puedePublicar: capacidad.puedePublicar,
      motivo: capacidad.motivo ?? null,
      tokenDePaginaDisponible: capacidad.tokenDePaginaDisponible,
    };
  }

  /** Scopes reales del token, via debug_token. Requiere appId y appSecret. */
  private async inspectToken(): Promise<{ scopes: string[]; tipoDeToken: string | null; caduca: string | null }> {
    const { appId, appSecret, accessToken } = this.config;
    if (!appId || !appSecret || !accessToken) return { scopes: [], tipoDeToken: null, caduca: null };
    try {
      const res = await fetch(`${this.graph}/debug_token?input_token=${encodeURIComponent(accessToken)}`, {
        headers: { Authorization: `Bearer ${appId}|${appSecret}` },
      });
      const info = ((await res.json().catch(() => ({}))) as { data?: { scopes?: string[]; type?: string; expires_at?: number } }).data ?? {};
      return {
        scopes: info.scopes ?? [],
        tipoDeToken: info.type ?? null,
        caduca: info.expires_at === 0 ? "nunca" : info.expires_at ? new Date(info.expires_at * 1000).toISOString() : null,
      };
    } catch {
      return { scopes: [], tipoDeToken: null, caduca: null };
    }
  }

  private async publishInstagram(input: PublishInput): Promise<PublishResult> {
    if (!input.mediaUrl) {
      return { ok: false, errorCode: "MEDIA_REQUIRED", error: "Instagram necesita una imagen o un video para publicar." };
    }
    const igUserId = this.igUserId;
    const video = isVideo(input.mediaUrl);
    // El caption llega ya compuesto: la llamada a la accion y la URL se
    // resuelven al crear la publicacion, en `lib/social/cta`, para que lo que
    // se ve en la vista previa y lo que se envia sean el mismo texto.
    const caption = input.caption;

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
    const pageId = this.pageId;
    // Igual que en Instagram: el caption viene compuesto desde `lib/social/cta`
    // y aqui no se le añade nada, para no duplicar la URL que ya lleva dentro.
    const caption = input.caption;

    /**
     * Se publica con el token del usuario del sistema, como hasta ahora.
     *
     * Meta documenta que las publicaciones de pagina se hacen con un token DE
     * PAGINA, y cambiarlo es un candidato a resolver el rechazo 200. Pero
     * todavia no sabemos si esa es la causa: cambiar el camino de publicacion
     * a ciegas podria enmascarar el problema en vez de arreglarlo, y añade una
     * llamada a Graph en cada envio. El diagnostico ya informa de si se puede
     * derivar ese token; cuando se confirme la causa, se cambia con criterio.
     */

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

    // Sin imagen, `link` produce la tarjeta de enlace de Facebook, que es mejor
    // que la URL suelta en el texto. El caption compuesto ya no la lleva.
    const params: Record<string, string> = { message: caption };
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

/**
 * Identificador utilizable de una cuenta social.
 *
 * En la base hay cuentas cuyo `externalId` es la URL del perfil en vez del
 * identificador numerico ("https://www.facebook.com/profile.php?id=..."). Son
 * registros antiguos creados a mano. Pasarselos a Graph produciria un 404
 * confuso, asi que se descartan y el adaptador cae en la variable de entorno,
 * que es el comportamiento anterior y conocido.
 */
export function normalizeAccountId(raw: string | null | undefined): string | null {
  const valor = raw?.trim();
  if (!valor) return null;
  return /^\d+$/.test(valor) ? valor : null;
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
