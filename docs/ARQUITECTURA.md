# Arquitectura de R.A. Training CRM

## Flujo institucional

```text
Redes sociales
  → catálogo oficial en ra-training.com
  → formulario de captación del CRM
  → contacto + inscripción por curso
  → seguimiento por correo o WhatsApp
  → campus Moodle
  → finalización confirmada
  → envío controlado a R.A. Training Finance
  → emisión administrativa en Finance
  → consulta del último estado conocido desde el CRM
```

## Capas

- `src/app`: páginas públicas, panel y controladores HTTP.
- `src/lib/auth`: sesiones, hash de contraseñas y autorización por rol.
- `src/lib/leads.ts`: validación, normalización, deduplicación e inscripción.
- `src/lib/nurture`: plantillas, cola y adaptadores de correo/WhatsApp.
- `src/lib/social`: publicación atómica, recuperación y recurrencias.
- `src/lib/finance`: cliente de inscripción y servicio de handoff sin emisión.
- `prisma/schema.prisma`: persistencia PostgreSQL.

## Decisiones principales

- Una persona se representa una sola vez como `Lead` y puede tener varias `Enrollment`.
- La unicidad `leadId + courseId` evita una inscripción duplicada al mismo curso.
- Los campos históricos `Lead.courseId` y `Lead.financeInscripcionId` se conservaron para una migración progresiva.
- Las acciones administrativas sensibles verifican roles en el servidor, además de la protección general del panel.
- Los mensajes y publicaciones se reclaman mediante cambios atómicos de estado antes de procesarse.
- Las simulaciones se distinguen de envíos o publicaciones reales.

## Errores y auditoría

Las respuestas públicas usan mensajes comprensibles y no devuelven detalles de base de datos, rutas físicas, tokens o trazas. `AuditLog` guarda actor, acción, entidad, resultado y metadatos limitados.
