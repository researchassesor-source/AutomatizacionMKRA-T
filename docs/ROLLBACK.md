# Rollback

## Criterios para abortar

Detener el despliegue ante error de migración, deriva de esquema, pérdida de conteos, fallo general de autenticación, permisos incorrectos o cualquier llamada externa inesperada.

## Reversión de aplicación

1. Mantener o restablecer `FINANCE_MODE`, `SOCIAL_MODE` y `MESSAGING_MODE` en `simulation`.
2. Volver al último artefacto aprobado sin reescribir la rama Git.
3. Conservar las columnas y tablas aditivas; el código anterior sigue usando los campos históricos.
4. Verificar login, captura y lectura de cursos.

En Preview, primero desactivar o eliminar el deployment defectuoso y conservar sus logs. No apuntar otro deployment a la rama afectada y no reutilizarla para datos reales. Un redeploy del commit anterior no revierte migraciones aditivas; solo restaura el código.

## Reversión de datos

La migración no incluye un `down` automático. No ejecutar `DROP`, `db push`, `migrate reset` ni SQL improvisado. Si la base quedó inconsistente:

1. Bloquear escrituras de la aplicación.
2. Preservar evidencia y exportar los cambios posteriores al respaldo si fuera necesario.
3. Restaurar el respaldo verificado en una base nueva.
4. Cambiar la aplicación a la base restaurada mediante el procedimiento operativo aprobado.
5. Comparar conteos y reabrir solo después de la validación.

Las inscripciones de backfill son deterministas y los campos históricos permanecen intactos, pero no deben eliminarse manualmente como forma de rollback.

## Rollback del cierre del 6 de agosto de 2026

Vía rápida y sin pérdida de datos, en este orden:

1. `MESSAGING_MODE=simulation` y `SOCIAL_MODE=simulation` en Vercel y redeploy.
   Corta de inmediato cualquier envío o publicación real conservando todo el
   historial. Es el paso que resuelve el 95 % de los incidentes.
2. Si el problema es solo de correo, `EMAIL_PROVIDER=resend` (con
   `EMAIL_API_KEY`) o vaciar `SMTP_HOST` deja el canal en simulación sin tocar
   el resto del CRM.
3. Redeploy del commit anterior si el fallo es de código.

La migración `20260806010000_course_sessions_and_stream_links` es aditiva: el
código anterior ignora `course_sessions`, `courses.streamUrl`,
`outbound_messages.courseSessionId`, `automation_rules.requiresStreamUrl` y
`automation_rules.planKey`. **No hace falta revertirla para volver atrás.**

Solo si se decide eliminarla de forma deliberada, con respaldo previo y fuera de
horario de operación:

```sql
DROP TABLE "course_sessions";
ALTER TABLE "outbound_messages" DROP COLUMN "courseSessionId";
ALTER TABLE "automation_rules" DROP COLUMN "requiresStreamUrl", DROP COLUMN "planKey";
ALTER TABLE "courses" DROP COLUMN "streamUrl";
```

`DROP TABLE "course_sessions"` borra el calendario de sesiones. Los mensajes ya
enviados se conservan porque su relación es `ON DELETE SET NULL`.

## Rollback de Preview

1. Bloquear el avance si falla migrate deploy, migrate status o schema-check.
2. Conservar la rama Neon aislada para diagnóstico sin escribir nuevos datos.
3. Corregir la migración con una nueva migración versionada si el SQL ya llegó a un entorno compartido; no reescribir historial aplicado.
4. Para una rama Preview descartable y sin datos necesarios, eliminarla únicamente desde Neon después de cerrar/eliminar el deployment y verificar el identificador exacto.
5. Volver a desplegar y repetir la validación completa.

Nunca eliminar automáticamente ramas Neon ni deployments desde el build.
