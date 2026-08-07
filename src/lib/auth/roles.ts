import type { SessionRole } from "./session";

/**
 * Grupos de acceso con nombre.
 *
 * Antes cada ruta escribia su lista de roles a mano. Con dos perfiles eso son
 * 56 listas que hay que mantener sincronizadas, y basta olvidar una para que
 * Direccion se encuentre un 403 sin motivo aparente. Aqui la intencion se
 * declara una vez y las rutas la citan.
 *
 * La distincion importante no es de poder sino de superficie: Direccion puede
 * hacer todo lo operativo y administrativo. Lo unico reservado al perfil
 * tecnico es lo que solo sirve para diagnosticar averias o lo que destruye
 * datos de forma irreversible.
 */

/** Cualquiera que trabaje a diario en el CRM. */
export const OPERACION: readonly SessionRole[] = ["ADMIN", "DIRECCION", "MARKETING", "VENTAS"];

/** Cursos, redes, mensajes y automatizaciones. */
export const CONTENIDO: readonly SessionRole[] = ["ADMIN", "DIRECCION", "MARKETING"];

/** Contactos, seguimientos y pipeline. */
export const COMERCIAL: readonly SessionRole[] = ["ADMIN", "DIRECCION", "VENTAS"];

/** Acciones administrativas: usuarios, cierre de inscripciones, borrado de reglas. */
export const GESTION: readonly SessionRole[] = ["ADMIN", "DIRECCION"];

/**
 * Sala de maquinas. Diagnostico, integraciones y operaciones irreversibles.
 *
 * Direccion no entra aqui a proposito: no porque no se confie en quien usa ese
 * perfil, sino porque son acciones cuyo efecto no se entiende sin conocer el
 * funcionamiento interno, y equivocarse cuesta caro.
 */
export const TECNICO: readonly SessionRole[] = ["ADMIN"];

/** Solo lectura, incluido el perfil de consulta. */
export const CONSULTA: readonly SessionRole[] = ["ADMIN", "DIRECCION", "MARKETING", "VENTAS", "LECTURA"];

/** ¿Este rol ve la sala de maquinas? */
export function isTechnicalProfile(role: SessionRole): boolean {
  return role === "ADMIN";
}

/** Nombre del perfil tal como se muestra en la interfaz. */
export function profileLabel(role: SessionRole): string {
  switch (role) {
    case "ADMIN":
      return "Técnico";
    case "DIRECCION":
      return "Dirección";
    case "MARKETING":
      return "Marketing";
    case "VENTAS":
      return "Ventas";
    default:
      return "Consulta";
  }
}
