# Rollback

## Criterios para abortar

Detener el despliegue ante error de migración, deriva de esquema, pérdida de conteos, fallo general de autenticación, permisos incorrectos o cualquier llamada externa inesperada.

## Reversión de aplicación

1. Mantener o restablecer `FINANCE_MODE`, `SOCIAL_MODE` y `MESSAGING_MODE` en `simulation`.
2. Volver al último artefacto aprobado sin reescribir la rama Git.
3. Conservar las columnas y tablas aditivas; el código anterior sigue usando los campos históricos.
4. Verificar login, captura y lectura de cursos.

## Reversión de datos

La migración no incluye un `down` automático. No ejecutar `DROP`, `db push`, `migrate reset` ni SQL improvisado. Si la base quedó inconsistente:

1. Bloquear escrituras de la aplicación.
2. Preservar evidencia y exportar los cambios posteriores al respaldo si fuera necesario.
3. Restaurar el respaldo verificado en una base nueva.
4. Cambiar la aplicación a la base restaurada mediante el procedimiento operativo aprobado.
5. Comparar conteos y reabrir solo después de la validación.

Las inscripciones de backfill son deterministas y los campos históricos permanecen intactos, pero no deben eliminarse manualmente como forma de rollback.
