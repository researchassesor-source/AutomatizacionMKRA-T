# Candidato de release CRM

## Alcance

Este candidato incorpora usuarios individuales y roles, sesiones activas verificadas contra base de datos, contactos e inscripciones separadas, seguimientos, auditoría, mensajería simulada, redes sociales simuladas, webhook Moodle idempotente y handoff controlado a Finance. El CRM no emite certificados.

## Controles incluidos

- Contraseñas individuales con `scrypt`; cookies firmadas, `httpOnly`, `sameSite=lax`, seguras en Producción y con expiración.
- Invalidación inmediata de sesiones de usuarios desactivados y actualización del rol desde base de datos.
- Protección del último ADMIN activo y autorización por rol en servidor.
- Compatibilidad heredada limitada a login sin correo, controlada por `ADMIN_LEGACY_LOGIN_ENABLED`.
- Límites de tamaño, validación de entradas, rate limiting y mensajes de error genéricos.
- Claves únicas para captura, finalización Moodle, recurrencias sociales y secuencias de mensajes.
- Modo seguro obligatorio fuera de Producción para Finance, redes y mensajería.
- YouTube y LinkedIn identificados como conectores no disponibles; no se presentan como integraciones activas.

## Riesgos residuales aceptados para revisión

- El rate limiting es por instancia y memoria; un despliegue distribuido de alto tráfico requiere un almacén compartido.
- Los contratos live de Moodle y Finance y las credenciales/permisos de Meta y TikTok requieren validación externa aislada.
- TikTok puede exigir revisión de aplicación y dominio; YouTube y LinkedIn no tienen adaptador.
- El acceso heredado debe retirarse después de crear y comprobar usuarios individuales.
- Un Preview solo es seguro con base y secretos propios, sin reutilizar recursos de Producción.

## Condiciones de aprobación

- Migraciones probadas primero sobre una restauración aislada.
- `npm ci`, auditoría de dependencias, Prisma, tipos, pruebas, build y `git diff --check` aprobados.
- Flujos manuales realizados con datos ficticios y eliminados al terminar.
- Integraciones en `simulation`; ningún mensaje, publicación o operación Finance real durante QA.
- Revisión humana del diff, variables, respaldo, rollback y permisos antes de desplegar.
