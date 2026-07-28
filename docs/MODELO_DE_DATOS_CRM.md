# Modelo de datos del CRM

## Entidades principales

- `AdminUser`: identidad administrativa, hash, rol, estado y último acceso.
- `Course`: catálogo, URL oficial, Moodle, categoría, precio, duración y banderas comerciales.
- `Lead`: persona/contacto, datos normalizados, consentimiento, origen, etapa, responsable y archivo.
- `Enrollment`: interés o inscripción única de un contacto a un curso, con estados separados de Moodle, Finance y certificado.
- `LeadNote`: nota comercial con autor.
- `FollowUp`: llamada, WhatsApp, correo, reunión o recordatorio con vencimiento.
- `LeadEvent`: actividad e idempotencia de formularios/webhooks.
- `AuditLog`: bitácora administrativa sin secretos.
- `OutboundMessage` y `MessageTemplate`: cola, simulación, reintentos y plantillas.
- `SocialAccount`, `SocialPost` y `SocialSchedule`: cuentas, publicaciones y recurrencias.

## Compatibilidad

`Lead.courseId` y `Lead.financeInscripcionId` están marcados como históricos. No se borran automáticamente. Los datos nuevos usan `Enrollment`, que mantiene una referencia de Finance independiente por curso.

## Estados

- Inscripción: `INTERESADO`, `INSCRITO`, `EN_CURSO`, `COMPLETADO`, `CANCELADO`.
- Finance: `NO_ENVIADO`, `PENDIENTE`, `ENVIANDO`, `ENVIADO`, `ERROR`.
- Certificado: `PENDIENTE`, `EMITIDO`, `ANULADO`, `DESCONOCIDO`.
- Mensaje: incluye `SIMULADO` y `CANCELADO` para no confundir pruebas con envíos reales.
- Publicación: incluye `SIMULADO` y `CANCELADO` con recuperación de bloqueos.
