export type PostStatusPresentation = {
  label: string;
  tone: "ok" | "warn" | "err" | "info";
};

export function postStatusPresentation(status: string): PostStatusPresentation {
  if (["PUBLICADO", "ACEPTADO"].includes(status)) return { label: "Publicado", tone: "ok" };
  if (status === "SIMULADO") return { label: "En simulación", tone: "info" };
  if (status === "PROGRAMADO") return { label: "Programado", tone: "warn" };
  if (status === "BORRADOR") return { label: "Borrador", tone: "info" };
  if (status === "FALLIDO") return { label: "No salió", tone: "err" };
  if (status === "CANCELADO") return { label: "Cancelado", tone: "warn" };
  if (status === "ARCHIVADO") return { label: "Guardado", tone: "info" };
  return { label: "En proceso", tone: "info" };
}
