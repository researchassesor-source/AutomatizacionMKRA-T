import { ROLE_PRESENTATION } from "@/lib/auth/role-presentation";

const labels: Record<string, string> = {
  ADMIN: ROLE_PRESENTATION.ADMIN.label,
  DIRECCION: ROLE_PRESENTATION.DIRECCION.label,
  MARKETING: ROLE_PRESENTATION.MARKETING.label,
  VENTAS: ROLE_PRESENTATION.VENTAS.label,
  LECTURA: ROLE_PRESENTATION.LECTURA.label,
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
  REAL: "Real",
  TEST: "Prueba técnica",
  DEMO: "Demostración",
  UNKNOWN: "Por clasificar",
  DRAFT: "Borrador",
  ACTIVE: "Activa",
  PAUSED: "Pausada",
  ARCHIVED: "Archivada",
  ON_REGISTRATION: "Al inscribirse",
  BEFORE_COURSE: "Antes de cada sesión",
  AFTER_COURSE: "Después de la última sesión",
  ACEPTADO: "Aceptado por proveedor",
  ENTREGADO: "Entregado",
  REBOTADO: "Rebotado",
  NEVER_SYNCED: "Sin sincronizar",
  SYNCED: "Sincronizado",
  CONFLICT: "Conflicto",
  ERROR: "Error",
  SIMULATION: "Simulación",
  READY: "Conexión validada",
  EXPIRED: "Token vencido",
  DISCONNECTED: "Desconectada",
  MISSING_PERMISSION: "Permisos insuficientes",
  ARCHIVADO: "Archivado",
  ELIMINADO_LOCAL: "Eliminado localmente",
  ELIMINADO_PROVEEDOR: "Eliminado en proveedor",
  EMAIL: "Correo electrónico",
  WHATSAPP: "WhatsApp",
  TELEFONO: "Teléfono",
  MATCH: "Coincidente",
  MISSING_IN_CRM: "Falta en el CRM",
  EXTRA_IN_CRM: "Histórico o sobrante",
  DIFFERENT: "Datos distintos",
  AdminUser: "Usuario administrativo",
  Course: "Curso",
  CourseCatalog: "Catálogo de cursos",
  Lead: "Contacto",
  Enrollment: "Inscripción",
  FollowUp: "Seguimiento",
  OutboundMessage: "Mensaje",
  SocialAccount: "Cuenta social",
  SocialPost: "Publicación social",
  SocialSchedule: "Recurrencia social",
  MessageTemplate: "Plantilla de mensaje",
  Campaign: "Campaña",
  AutomationRule: "Regla de automatización",
  CatalogSyncRun: "Sincronización de catálogo",
  CourseSession: "Sesión del curso",
  EmailProvider: "Servidor de correo",
  Session: "Sesión",
  PUBLICANDO: "Publicando",
  ENVIANDO: "Enviando",
  OMITIDO: "Omitido",
  CANCELADO: "Cancelado",
  SIMULADO: "Simulado",
  INTERESADO: "Interesado",
  INSCRITO: "Inscrito",
  EN_CURSO: "En curso",
  MISSING_STREAM_URL: "Falta el enlace de transmisión",
  SESSION_REMOVED: "La sesión fue eliminada",
  ENROLLMENT_CANCELLED: "La inscripción fue cancelada",
  AUTOMATION_DISABLED: "La automatización fue pausada",
  AUTOMATION_DELETED: "La automatización fue eliminada",
  CONNECTOR_UNAVAILABLE: "Conector no disponible",
  MEDIA_NOT_PUBLIC: "La imagen no tiene una URL pública",
  MEDIA_REQUIRED: "Falta la imagen o el video",
  IG_PROCESSING: "Instagram sigue procesando el contenido",
  NOT_CONFIGURED: "Integración sin configurar",
  AUTH_LOGIN: "Inicio de sesión",
  AUTH_LOGIN_LEGACY: "Inicio de sesión heredado",
  AUTH_LOGOUT: "Cierre de sesión",
  ADMIN_USER_CREATED: "Usuario creado",
  ADMIN_USER_UPDATED: "Usuario actualizado",
  LEADS_EXPORTED: "Contactos exportados",
  LEAD_CREATED: "Contacto creado",
  LEAD_CREATED_MANUALLY: "Contacto creado manualmente",
  LEAD_UPDATED: "Contacto actualizado",
  LEAD_ARCHIVED: "Contacto archivado",
  LEAD_RESTORED: "Contacto restaurado",
  LEAD_CLASSIFICATION_CHANGED: "Clasificación actualizada",
  LEAD_TEST_DELETED: "Registro de prueba eliminado",
  LEAD_STAGE_CHANGED: "Etapa comercial actualizada",
  COURSE_CREATED: "Curso creado",
  COURSE_UPDATED: "Curso actualizado",
  COURSE_DEACTIVATED: "Curso desactivado",
  COURSE_CATALOG_IMPORTED: "Catálogo oficial importado",
  COURSE_CATALOG_IMPORT_NO_CHANGES: "Catálogo oficial verificado sin cambios",
  COURSE_CATALOG_HISTORICAL_DEACTIVATED: "Curso histórico desactivado",
  FINANCE_HANDOFF: "Envío preparado para Finance",
  FINANCE_HANDOFF_SIMULATED: "Envío a Finance simulado",
  MESSAGE_CANCELLED: "Mensaje cancelado",
  MESSAGE_RETRIED: "Mensaje reintentado",
  MESSAGE_SIMULATED: "Mensaje simulado",
  MESSAGE_OMITTED: "Mensaje omitido",
  MESSAGE_PROVIDER_ACCEPTED: "Mensaje aceptado por proveedor",
  MESSAGE_PROVIDER_FAILED: "Fallo de proveedor de mensajes",
  MESSAGE_PROVIDER_STATUS_UPDATED: "Estado de entrega actualizado",
  AUTOMATION_MESSAGES_QUEUED: "Mensajes automáticos programados",
  AUTOMATION_SCHEDULING_FAILED: "Fallo al programar automatización",
  AUTOMATION_COURSE_RESCHEDULED: "Recordatorios recalculados",
  AUTOMATION_PLAN_APPLIED: "Plan de correos aplicado",
  AUTOMATION_RULE_CREATED: "Automatización creada",
  COURSE_SESSION_CREATED: "Sesión de curso creada",
  COURSE_SESSION_UPDATED: "Sesión de curso actualizada",
  COURSE_SESSION_DELETED: "Sesión de curso eliminada",
  COURSE_STREAM_URL_UPDATED: "Enlace de transmisión actualizado",
  EMAIL_CONNECTION_TESTED: "Servidor de correo comprobado",
  EMAIL_TEST_SENT: "Correo de prueba enviado",
  MESSAGE_DISPATCH_REQUESTED: "Ejecución manual de mensajes",
  SOCIAL_ACCOUNTS_SYNCED: "Cuentas de Meta sincronizadas",
  SOCIAL_POST_DUPLICATED: "Publicación duplicada",
  AUTOMATION_RULE_UPDATED: "Automatización actualizada",
  AUTOMATION_RULE_DELETED: "Automatización eliminada",
  CAMPAIGN_CREATED: "Campaña creada",
  CAMPAIGN_UPDATED: "Campaña actualizada",
  CAMPAIGN_ARCHIVED: "Campaña archivada",
  SOCIAL_ACCOUNT_SAVED: "Cuenta social guardada",
  SOCIAL_ACCOUNT_UPDATED: "Cuenta social actualizada",
  SOCIAL_ACCOUNT_DEACTIVATED: "Cuenta social desactivada",
  SOCIAL_POST_CREATED: "Publicación creada",
  SOCIAL_POST_PUBLISH_REQUESTED: "Publicación solicitada",
  SOCIAL_POST_DELETED_LOCAL: "Publicación local eliminada",
  SOCIAL_CONNECTION_CHECKED: "Conexión social comprobada",
  WORDPRESS_CATALOG_SYNCED: "Catálogo WordPress sincronizado",
  WORDPRESS_CATALOG_SYNC_FAILED: "Sincronización WordPress fallida",
  SOCIAL_SCHEDULE_CREATED: "Recurrencia creada",
  FOLLOW_UP_CREATED: "Seguimiento creado",
  FOLLOW_UP_UPDATED: "Seguimiento actualizado",
  FOLLOW_UP_RESCHEDULED: "Seguimiento reprogramado",
};

export function presentAdminValue(value: string | null | undefined) {
  if (!value) return "—";
  if (labels[value]) return labels[value];
  const normalized = value.replaceAll("_", " ").toLocaleLowerCase("es");
  return normalized.charAt(0).toLocaleUpperCase("es") + normalized.slice(1);
}

/**
 * Acciones de auditoria en el idioma de quien las lee.
 *
 * Se registran con nombres tecnicos porque son claves estables del sistema,
 * pero "Form submit success" no le dice nada a quien revisa quien hizo que.
 * La clave interna sigue intacta en la base y en la vista tecnica.
 */
const ACCIONES_AUDITORIA: Record<string, string> = {
  FORM_VIEWED: "Vio el formulario",
  FORM_STARTED: "Empezó a llenar el formulario",
  FORM_SUBMIT_ATTEMPT: "Intentó enviar el formulario",
  FORM_SUBMIT_SUCCESS: "Envió el formulario",
  FORM_SUBMIT_REJECTED: "Envío del formulario rechazado",
  CONTACT_CREATED: "Contacto creado",
  CONTACT_UPDATED: "Contacto actualizado",
  CONSENT_RECORDED: "Consentimiento registrado",
  ENROLLMENT_CREATED: "Inscripción creada",
  AUTOMATION_MESSAGES_QUEUED: "Comunicaciones programadas",
  AUTOMATION_PLAN_APPLIED: "Plan de comunicaciones aplicado",
  AUTOMATION_RULE_UPDATED: "Automatización actualizada",
  AUTOMATION_RULES_PAUSED_BY_SYNC: "Automatizaciones pausadas por sincronización",
  MESSAGE_PROVIDER_ACCEPTED: "Mensaje aceptado por el proveedor",
  MESSAGE_PROVIDER_FAILED: "El proveedor rechazó el mensaje",
  MESSAGE_PROVIDER_STATUS_UPDATED: "Estado del mensaje actualizado",
  MESSAGE_SIMULATED: "Mensaje simulado (sin envío real)",
  MESSAGE_OMITTED: "Mensaje omitido",
  MESSAGE_DISPATCH_BLOCKED: "Envío bloqueado por configuración",
  EMAIL_CONNECTION_TESTED: "Prueba de conexión de correo",
  AUTH_LOGIN: "Inicio de sesión",
  AUTH_LOGOUT: "Cierre de sesión",
  AUTH_LOGIN_FAILED: "Intento de acceso fallido",
  USER_CREATED: "Usuario creado",
  USER_UPDATED: "Usuario actualizado",
  LEAD_UPDATED: "Contacto editado",
  LEAD_ARCHIVED: "Contacto archivado",
  LEAD_RESTORED: "Contacto restaurado",
  LEAD_DELETED: "Contacto eliminado",
  LEAD_TEST_DELETED: "Contacto de prueba eliminado",
  LEAD_CLASSIFICATION_CHANGED: "Clasificación del contacto cambiada",
  LEADS_EXPORTED: "Contactos exportados",
  COURSE_SESSION_CREATED: "Sesión creada",
  COURSE_SESSION_UPDATED: "Sesión actualizada",
  COURSE_SESSION_DELETED: "Sesión eliminada",
  COURSE_STREAM_URL_UPDATED: "Enlace de reunión actualizado",
  CATALOG_SYNCED: "Catálogo sincronizado",
  SOCIAL_ACCOUNTS_SYNCED: "Cuentas de redes sincronizadas",
  SOCIAL_POST_CREATED: "Publicación creada",
  SOCIAL_POST_PUBLISHED: "Publicación enviada",
  SOCIAL_POST_FAILED: "La publicación no pudo enviarse",
  WHATSAPP_WEBHOOK_PROCESSED: "Aviso de WhatsApp procesado",
  WHATSAPP_INBOUND_IGNORED: "Mensaje entrante de WhatsApp descartado",
  WHATSAPP_INBOUND_PROCESSED: "Respuesta automática de WhatsApp procesada",
  WHATSAPP_WEBHOOK_SIGNATURE_REJECTED: "Aviso de WhatsApp con firma no válida",
  WHATSAPP_WEBHOOK_VERIFICATION_REJECTED: "Verificación de WhatsApp rechazada",
  WHATSAPP_WEBHOOK_MALFORMED: "Aviso de WhatsApp no interpretable",
};

/** Traduccion de una accion de auditoria; si no se conoce, se deja legible. */
export function presentAuditAction(action: string): string {
  return ACCIONES_AUDITORIA[action] ?? action.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** Área humana derivada de claves ya existentes; no cambia el evento guardado. */
export function presentAuditArea(action: string, entityType: string): string {
  if (action.startsWith("AUTH_") || entityType === "Session" || entityType === "AdminUser") return "Acceso";
  if (action.startsWith("LEAD_") || action.startsWith("CONTACT_") || entityType === "Lead" || entityType === "Enrollment") return "Contactos";
  if (action.startsWith("COURSE_") || action.startsWith("CATALOG_") || entityType === "Course" || entityType === "CourseSession") return "Cursos";
  if (action.startsWith("MESSAGE_") || entityType === "OutboundMessage" || entityType === "MessageTemplate") return "Comunicaciones";
  if (action.startsWith("AUTOMATION_") || entityType === "AutomationRule" || entityType === "Campaign") return "Automatizaciones";
  if (action.startsWith("SOCIAL_") || entityType === "SocialPost" || entityType === "SocialAccount") return "Publicaciones";
  if (action.includes("WEBHOOK") || action.includes("CONNECTION")) return "Integraciones";
  return "Sistema";
}

const SENSITIVE_AUDIT_KEY = /(password|passphrase|secret|token|authorization|cookie|credential|api[-_]?key|database[-_]?url)/i;

/** Copia de presentación que oculta secretos sin modificar los metadatos persistidos. */
export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_AUDIT_KEY.test(key) ? "[oculto]" : redactAuditMetadata(item),
    ]));
  }
  if (typeof value === "string") {
    return value
      .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credenciales ocultas]@")
      .replace(/(bearer\s+)[a-z0-9._~-]+/gi, "$1[oculto]");
  }
  return value;
}
