/**
 * Parte de la vista que comparten servidor y navegador.
 *
 * Vive aparte porque `view-mode.ts` importa `next/headers`, que solo existe en
 * el servidor: si el selector importara de alli, arrastraria codigo de servidor
 * a un componente de cliente y la compilacion falla.
 */
export const VIEW_COOKIE = "ra_crm_vista";

export type ViewMode = "direccion" | "tecnica";

export function parseViewMode(raw: string | undefined): ViewMode | null {
  if (raw === "direccion") return "direccion";
  if (raw === "tecnica") return "tecnica";
  return null;
}
