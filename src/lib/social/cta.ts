import type { Platform } from "./types";
import { normalizeSocialCaption } from "./caption-formatting";

/**
 * Llamada a la accion por red.
 *
 * Facebook e Instagram no pueden tratarse igual, y fingir que si es lo que
 * produjo el problema que resuelve este archivo: la misma URL se pegaba al
 * final de los dos captions, y en Instagram quedaba como texto muerto que
 * nadie puede pulsar. Larga, fea e inutil.
 *
 * Las reglas son:
 *
 *   Facebook  -> la URL viaja en el cuerpo, donde Facebook la convierte en
 *                enlace navegable. Si el texto ya la traia, no se repite.
 *   Instagram -> el caption NO produce enlaces. En vez de ensuciarlo con una
 *                URL que no lleva a ninguna parte, se añade una llamada a la
 *                accion que dirige al enlace de la biografia.
 *
 * Todo esto se calcula UNA vez y en un solo sitio, porque la vista previa y lo
 * que se publica tienen que ser literalmente el mismo texto. Cuando el panel
 * calculaba su propia previsualizacion, cualquier diferencia con el servidor
 * se descubria despues de publicar.
 */

/** CTA por defecto de Instagram. Editable desde el compositor. */
export const CTA_INSTAGRAM_POR_DEFECTO = "👉 Inscríbete desde el enlace en nuestra bio.";

export const AVISO_INSTAGRAM_SIN_ENLACE =
  "Instagram no ofrece un enlace clicable en esta publicación. Usa el enlace del perfil para llevar a las personas al destino.";

/**
 * ¿Sirve como URL de destino publica?
 *
 * Se exige HTTPS porque Facebook degrada o rechaza el contenido mixto, y
 * porque un enlace http en una publicacion de la empresa es una mala señal
 * para quien lo recibe. Localhost y las IP directas quedan fuera: son
 * direcciones que solo funcionan en la maquina de quien las escribio.
 */
export function esUrlDestinoValida(valor: string): boolean {
  const limpio = valor.trim();
  if (!limpio) return false;
  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host)) return false;
  // Una IP literal no es un destino publicable: no tiene certificado valido a
  // nombre de nadie y no sobrevive a un cambio de servidor.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  // Un dominio sin punto (p. ej. "intranet") solo resuelve en una red interna.
  return host.includes(".");
}

/** Parametros de campaña: no cambian el destino, asi que no cuentan al comparar. */
const PARAMETROS_DE_CAMPANA = /^(utm_|fbclid$|gclid$|igshid$|mc_cid$|mc_eid$)/i;

/**
 * Forma canonica de una URL para poder compararla.
 *
 * Sin esto, "https://ra-training.com/cursos/ia/" y
 * "https://www.ra-training.com/cursos/ia?utm_source=ig" se leen como distintas
 * y la URL acabaria dos veces en el mismo texto.
 */
export function urlCanonica(valor: string): string | null {
  try {
    const url = new URL(valor.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const ruta = url.pathname.replace(/\/+$/, "");
    const parametros = [...url.searchParams.entries()]
      .filter(([clave]) => !PARAMETROS_DE_CAMPANA.test(clave))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([clave, valor]) => `${clave}=${valor}`)
      .join("&");
    return `${host}${ruta}${parametros ? `?${parametros}` : ""}`;
  } catch {
    return null;
  }
}

/** URLs que aparecen escritas dentro de un texto. */
export function urlsEnTexto(texto: string): string[] {
  return texto.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
}

/** ¿El texto ya menciona esta URL, aunque sea con otra forma? */
export function textoYaIncluyeUrl(texto: string, url: string): boolean {
  const objetivo = urlCanonica(url);
  if (!objetivo) return false;
  return urlsEnTexto(texto).some((encontrada) => urlCanonica(encontrada) === objetivo);
}

export type EntradaComposicion = {
  plataforma: Platform;
  /** Texto que escribe la persona, sin CTA ni URL añadidas. */
  textoBase: string;
  /** URL de destino, si la hay. */
  urlDestino?: string | null;
  /**
   * CTA propio de Instagram. Vacio a proposito significa "no añadas nada":
   * hay publicaciones que no quieren llamada a la accion, y meterla igual
   * seria decidir por quien escribe.
   */
  ctaInstagram?: string | null;
};

/**
 * Texto final que se publica en esa red. Es tambien el que se enseña en la
 * vista previa: son la misma llamada.
 *
 * Los saltos de linea y los hashtags del texto base no se tocan nunca; lo
 * añadido va siempre al final, separado por una linea en blanco.
 */
export function componerCaption(entrada: EntradaComposicion): string {
  const base = normalizeSocialCaption(entrada.textoBase).replace(/\s+$/, "");
  const url = entrada.urlDestino?.trim() || "";

  if (entrada.plataforma === "INSTAGRAM") {
    const cta = entrada.ctaInstagram?.trim() || "";
    // La URL no entra: en Instagram no seria pulsable y solo ocupa espacio.
    if (!cta) return base;
    if (base.includes(cta)) return base;
    return `${base}\n\n${cta}`;
  }

  // Facebook y el resto: la URL sirve, siempre que no este ya escrita.
  if (!url || !esUrlDestinoValida(url)) return base;
  if (textoYaIncluyeUrl(base, url)) return base;
  return `${base}\n\n${url}`;
}

/**
 * ¿Hay que avisar de que Instagram no dara un enlace pulsable?
 *
 * Solo cuando hay algo que enlazar y una cuenta de Instagram elegida: avisar
 * siempre convertiria el mensaje en ruido que se deja de leer.
 */
export function requiereAvisoInstagram(plataformas: readonly Platform[], urlDestino?: string | null): boolean {
  return plataformas.includes("INSTAGRAM") && Boolean(urlDestino?.trim());
}
