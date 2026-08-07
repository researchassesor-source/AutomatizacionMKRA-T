import { cookies } from "next/headers";
import type { SessionRole } from "./session";
import { isTechnicalProfile } from "./roles";
import { VIEW_COOKIE, parseViewMode, type ViewMode } from "./view-mode-shared";

/**
 * Vista activa del panel.
 *
 * El interruptor anterior vivia en el navegador, asi que el servidor no podia
 * saberlo: la navegacion y los paneles tecnicos se decidian por el rol y
 * seguian apareciendo con el detalle apagado. Una cookie si viaja con la
 * peticion, de modo que servidor y cliente coinciden y "Vista Direccion"
 * significa de verdad lo mismo que ve direccion.
 *
 * No es un permiso. Los permisos siguen dependiendo del rol y se comprueban en
 * las rutas; esto solo decide que se muestra.
 */
export { VIEW_COOKIE, parseViewMode, type ViewMode } from "./view-mode-shared";

/**
 * Vista efectiva de esta peticion.
 *
 * Quien no tiene perfil tecnico ve siempre la vista de direccion: no existe
 * ninguna combinacion en la que la cookie le muestre infraestructura.
 */
export async function resolveViewMode(role: SessionRole): Promise<ViewMode> {
  if (!isTechnicalProfile(role)) return "direccion";
  const store = await cookies();
  return parseViewMode(store.get(VIEW_COOKIE)?.value) ?? "tecnica";
}

/** ¿Esta peticion muestra infraestructura? */
export async function showsTechnical(role: SessionRole): Promise<boolean> {
  return (await resolveViewMode(role)) === "tecnica";
}
