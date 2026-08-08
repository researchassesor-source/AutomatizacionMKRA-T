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
      /**
       * La conexion esta bien si la pagina responde. Ni mas ni menos.
       *
       * Antes esto devolvia `ok: false` cuando no lograba confirmar la
       * capacidad de publicar, y como esa comprobacion estaba mal hecha el
       * panel acusaba de "permisos insuficientes" a una configuracion sana.
       * Fallar la conexion por no poder verificar OTRA cosa es afirmar de mas.
       *
       * Que la conexion este configurada no implica que publicar funcione: esa
       * distincion la hace el estado de integracion, que mira si hubo un envio
       * real correcto.
       */
      return {
        ok: true,
        name: typed.name,
        details: {
          pageId: String(typed.id ?? ""),
          instagramLinked: Boolean(linkedInstagram),
          instagramMatchesConfig: Boolean(linkedInstagram && linkedInstagram === this.igUserId),
          conexionConfigurada: true,
          publicacionVerificada: false,
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
   * Diagnostico de permisos de Facebook. Solo lecturas; no publica nada.
   *
   * La primera version de esto pedia `/{pageId}?fields=tasks`, y `tasks` no es
   * un campo del nodo Page: Meta respondia `(#100) Tried accessing nonexisting
   * field (tasks)` y el diagnostico lo traducia como "permisos insuficientes".
   * Es el peor fallo posible en una herramienta de diagnostico: acusar a la
   * configuracion de un error propio, y mandar a alguien a cambiar permisos
   * que estaban bien.
   *
   * De ahi las dos reglas que gobiernan este metodo:
   *
   *   - Una consulta que falla por culpa NUESTRA (campo inexistente, peticion
   *     mal formada) nunca se reporta como permiso ausente. Se reporta como
   *     "no verificable".
   *   - Poder LEER la pagina no prueba que se pueda publicar en ella. Solo un
   *     envio real verifica eso, y ese dato no vive aqui.
   *
   * Cada comprobacion es independiente: que una no se pueda hacer no invalida
   * las demas.
   */
  async diagnose(): Promise<Record<string, unknown>> {
    const [identidad, pagina, permisos, tareas, tokenDePagina] = await Promise.all([
      this.get("me?fields=id,name"),
      // Identidad de la pagina: id y name son campos validos del nodo Page.
      this.get(`${this.pageId}?fields=id,name`),
      this.leerPermisos(),
      this.leerTareasDeLaPagina(),
      this.comprobarTokenDePagina(),
    ]);

    const paginaAccesible = !pagina.error;
    const nombreDeLaPagina = (pagina as GraphResponse & { name?: string }).name ?? null;

    return {
      plataforma: this.platform,
      destinoConfigurado: this.platform === "FACEBOOK" ? Boolean(this.pageId) : Boolean(this.igUserId),
      /** De donde sale el destino: de la cuenta elegida o de la variable. */
      origenDelDestino: this.targetId ? "cuenta seleccionada" : "variable de entorno",

      tokenValido: !identidad.error,
      identidadDelToken: identidad.error
        ? `error: ${identidad.error.message ?? "sin detalle"}`
        : ((identidad as { name?: string }).name ?? "sin nombre"),

      paginaAccesible,
      nombreDeLaPagina,
      paginaMotivo: paginaAccesible ? null : (pagina.error?.message ?? "sin detalle"),

      ...permisos,
      ...tareas,
      ...tokenDePagina,

      // Leer la pagina no prueba nada sobre publicar. Solo un envio real lo
      // verifica, y ese dato lo aporta el historial, no la Graph API.
      publicacionVerificada: false,
      publicacionMotivo: "Solo un envío real correcto verifica la publicación. Este diagnóstico no publica nada.",
    };
  }

  /**
   * Permisos concedidos al token, via `/me/permissions`.
   *
   * Es la consulta documentada y no necesita el secreto de la app, a
   * diferencia de `debug_token`.
   */
  private async leerPermisos(): Promise<{
    scopesVerificables: boolean;
    scopesConcedidos: string[];
    scopesRequeridosAusentes: string[];
    scopesMotivo: string | null;
  }> {
    const REQUERIDOS = ["pages_manage_posts", "pages_read_engagement"];
    const data = await this.get("me/permissions");
    const typed = data as GraphResponse & { data?: Array<{ permission?: string; status?: string }> };

    if (data.error || !Array.isArray(typed.data)) {
      return {
        scopesVerificables: false,
        scopesConcedidos: [],
        scopesRequeridosAusentes: [],
        scopesMotivo: `No se pudieron leer los permisos del token: ${data.error?.message ?? "respuesta inesperada"}.`,
      };
    }

    const concedidos = typed.data
      .filter((item) => item.status === "granted" && item.permission)
      .map((item) => item.permission as string);
    return {
      scopesVerificables: true,
      scopesConcedidos: concedidos.sort(),
      scopesRequeridosAusentes: REQUERIDOS.filter((permiso) => !concedidos.includes(permiso)),
      scopesMotivo: null,
    };
  }

  /**
   * Tareas sobre la pagina, buscandola dentro de `/me/accounts`.
   *
   * `tasks` solo existe como campo de las entradas de esa arista, nunca como
   * campo del nodo Page. Y con un token de usuario del sistema la arista puede
   * venir vacia siendo todo correcto: un sistema no "tiene paginas" del mismo
   * modo que una persona. Por eso la ausencia se informa como NO VERIFICABLE y
   * jamas como permiso que falta.
   */
  private async leerTareasDeLaPagina(): Promise<{
    tareasVerificables: boolean;
    tareasSobreLaPagina: string[];
    tareasMotivo: string | null;
  }> {
    const data = await this.get("me/accounts?fields=id,name,tasks&limit=100");
    const typed = data as GraphResponse & { data?: Array<{ id?: string; tasks?: string[] }> };

    if (data.error || !Array.isArray(typed.data)) {
      return {
        tareasVerificables: false,
        tareasSobreLaPagina: [],
        tareasMotivo: "Tareas no verificables con este tipo de token",
      };
    }

    const encontrada = typed.data.find((item) => item.id === this.pageId);
    if (!encontrada) {
      return {
        tareasVerificables: false,
        tareasSobreLaPagina: [],
        tareasMotivo: "Tareas no verificables con este tipo de token",
      };
    }
    return {
      tareasVerificables: true,
      tareasSobreLaPagina: encontrada.tasks ?? [],
      tareasMotivo: null,
    };
  }

  /**
   * ¿Se puede derivar un token de pagina? Comprobacion aparte y best-effort.
   *
   * No poder derivarlo NO significa que falten permisos para publicar: un
   * usuario del sistema puede publicar sin que esta arista le responda.
   */
  private async comprobarTokenDePagina(): Promise<{
    tokenDePaginaDisponible: boolean;
    tokenDePaginaMotivo: string | null;
  }> {
    const data = await this.get(`${this.pageId}?fields=access_token`);
    const disponible = Boolean((data as GraphResponse & { access_token?: string }).access_token);
    if (disponible) return { tokenDePaginaDisponible: true, tokenDePaginaMotivo: null };
    return {
      tokenDePaginaDisponible: false,
      tokenDePaginaMotivo: data.error
        ? `No verificable: ${data.error.message ?? "sin detalle"}. Con un usuario del sistema esto puede ser normal y no impide publicar.`
        : "No verificable con este tipo de token. Con un usuario del sistema puede ser normal y no impide publicar.",
    };
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
