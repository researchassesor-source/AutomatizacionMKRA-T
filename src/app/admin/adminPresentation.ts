const labels: Record<string, string> = {
  ADMIN: "Administrador",
  MARKETING: "Marketing",
  VENTAS: "Ventas",
  LECTURA: "Solo lectura",
  NUEVO: "Nuevo",
  CONTACTADO: "Contactado",
  OPORTUNIDAD: "Oportunidad",
  CLIENTE: "Cliente",
  DESCARTADO: "Descartado",
  PENDIENTE: "Pendiente",
  VENCIDO: "Vencido",
  COMPLETADO: "Completado",
  PROGRAMADO: "Programado",
  ENVIADO: "Enviado",
  FALLIDO: "Fallido",
  BORRADOR: "Borrador",
  PUBLICADO: "Publicado",
  ACTIVO: "Activo",
  INACTIVO: "Inactivo",
  EMAIL: "Correo electrónico",
  WHATSAPP: "WhatsApp",
  TELEFONO: "Teléfono",
};

export function presentAdminValue(value: string | null | undefined) {
  if (!value) return "—";
  if (labels[value]) return labels[value];
  const normalized = value.replaceAll("_", " ").toLocaleLowerCase("es");
  return normalized.charAt(0).toLocaleUpperCase("es") + normalized.slice(1);
}
