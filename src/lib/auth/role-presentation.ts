/**
 * Representación humana de los roles internos del CRM.
 *
 * Las claves son parte del contrato de autenticación y no se traducen ni se
 * renombran. Esta tabla solo decide cómo se presentan en la interfaz.
 */
export const ROLE_PRESENTATION = {
  DIRECCION: {
    label: "Dirección",
    description: "Gestión completa de la operación: contactos, cursos, comunicaciones, publicaciones y usuarios.",
  },
  ADMIN: {
    label: "Técnico",
    description: "Incluye toda la operación de Dirección más integraciones, automatizaciones, diagnóstico y auditoría técnica.",
  },
  MARKETING: {
    label: "Marketing",
    description: "Perfil histórico para contenidos, campañas y consulta de contactos.",
  },
  VENTAS: {
    label: "Ventas",
    description: "Perfil histórico para contactos, seguimientos y gestión comercial.",
  },
  LECTURA: {
    label: "Consulta",
    description: "Perfil histórico de consulta sin acciones administrativas.",
  },
} as const;

export type PresentedRole = keyof typeof ROLE_PRESENTATION;

export const ASSIGNABLE_PRODUCT_ROLES = ["DIRECCION", "ADMIN"] as const satisfies readonly PresentedRole[];
export type AssignableProductRole = (typeof ASSIGNABLE_PRODUCT_ROLES)[number];

export function isPresentedRole(role: string): role is PresentedRole {
  return role in ROLE_PRESENTATION;
}

export function roleLabel(role: string): string {
  return isPresentedRole(role) ? ROLE_PRESENTATION[role].label : role;
}

export function roleDescription(role: string): string {
  return isPresentedRole(role) ? ROLE_PRESENTATION[role].description : "Perfil conservado por compatibilidad.";
}
