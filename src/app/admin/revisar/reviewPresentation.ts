export type ReviewCategory = "configuration" | "review" | "incident" | "provider";

export type ReviewPresentation = {
  category: ReviewCategory;
  label: string;
  tone: "info" | "warn" | "err";
};

/**
 * Convierte el origen técnico de un pendiente en una categoría humana.
 * Los identificadores y la severidad originales se conservan sin cambios.
 */
export function reviewPresentation(id: string, severity: "warn" | "error"): ReviewPresentation {
  if (id.startsWith("enlace-") || id.startsWith("fecha-")) {
    return { category: "configuration", label: "Configuración", tone: "warn" };
  }
  if (id.startsWith("proveedor-")) {
    return { category: "provider", label: "Esperando proveedor", tone: "info" };
  }
  if (id.startsWith("revision-")) {
    return { category: "review", label: "Revisión", tone: "info" };
  }
  if (severity === "error") {
    return { category: "incident", label: "Incidencia", tone: "err" };
  }
  return { category: "review", label: "Revisión", tone: "info" };
}
