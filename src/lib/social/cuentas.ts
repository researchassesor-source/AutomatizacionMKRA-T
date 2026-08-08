import type { Platform } from "./types";
import { normalizeAccountId } from "./adapters/meta";

/**
 * Que cuenta representa a cada red, cuando hay mas de una registrada.
 *
 * La base arrastra duplicados de las primeras pruebas: la misma red dada de
 * alta dos veces, una con el identificador real de Meta y otra con la URL del
 * perfil pegada a mano. La de la URL no sirve para publicar —Graph no entiende
 * una URL como identificador— pero sigue apareciendo como cuenta activa.
 *
 * Esta seleccion vivia escrita dentro de la pagina, sin pruebas. Funcionaba,
 * pero nadie podia saberlo sin leerla, y basta reordenar una consulta para que
 * empiece a elegir la cuenta antigua sin que nada avise. Aqui esta explicita y
 * cubierta.
 *
 * No se borra nada: las cuentas antiguas conservan su historial y siguen
 * visibles en el panel tecnico. Solo dejan de ofrecerse como destino nuevo.
 */

export type CuentaSocial = {
  id: string;
  platform: Platform | string;
  displayName: string;
  externalId: string | null;
  isActive: boolean;
};

/** Meta exige identificadores numericos; TikTok usa los suyos, con guiones. */
function exigeIdNumerico(platform: string): boolean {
  return platform === "FACEBOOK" || platform === "INSTAGRAM";
}

/**
 * ¿Puede esta cuenta ser destino de una publicacion nueva?
 *
 * Una cuenta de Meta cuyo `externalId` es una URL publicaria en la pagina de
 * la variable de entorno en lugar de en la que dice su nombre. Es peor que un
 * error: es publicar en el sitio equivocado creyendo que se acerto.
 */
export function esCuentaPublicable(cuenta: Pick<CuentaSocial, "platform" | "externalId" | "isActive">): boolean {
  if (!cuenta.isActive) return false;
  if (!exigeIdNumerico(cuenta.platform)) return Boolean(cuenta.externalId?.trim());
  return normalizeAccountId(cuenta.externalId) !== null;
}

/** Motivo legible de por que una cuenta no se ofrece. */
export function motivoNoPublicable(cuenta: Pick<CuentaSocial, "platform" | "externalId" | "isActive">): string | null {
  if (esCuentaPublicable(cuenta)) return null;
  if (!cuenta.isActive) return "La cuenta está desactivada.";
  if (!cuenta.externalId?.trim()) return "La cuenta no tiene identificador de la red, así que no se sabe dónde publicaría.";
  return "La cuenta guarda la dirección del perfil en lugar del identificador de la red. Es un registro antiguo y no se puede publicar en él.";
}

/**
 * Una cuenta por red: la publicable; si hay varias, la primera de la lista.
 *
 * El orden de entrada decide el desempate, asi que quien llama debe pasarlas
 * ya ordenadas por antiguedad si eso le importa.
 */
export function cuentasCanonicasPorRed<T extends CuentaSocial>(cuentas: readonly T[]): T[] {
  const porRed = new Map<string, T>();
  for (const cuenta of cuentas) {
    const previa = porRed.get(cuenta.platform);
    if (!previa) {
      porRed.set(cuenta.platform, cuenta);
      continue;
    }
    // Una cuenta publicable siempre gana a una que no lo es.
    if (esCuentaPublicable(cuenta) && !esCuentaPublicable(previa)) porRed.set(cuenta.platform, cuenta);
  }
  return [...porRed.values()].filter((cuenta) => esCuentaPublicable(cuenta));
}
