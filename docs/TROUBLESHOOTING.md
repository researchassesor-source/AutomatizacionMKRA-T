# Solución de problemas de despliegue

## Prisma P3005: el esquema no está vacío

P3005 aparece cuando Neon copia para Preview una base que ya contiene el esquema histórico, pero `_prisma_migrations` no registra el baseline. Ejecutar de nuevo el baseline intentaría recrear tablas existentes.

`scripts/prepare-preview-migrations.mjs` inspecciona en modo de solo lectura:

- las seis tablas históricas y todas sus columnas;
- ausencia de `admin_users`, `courses.category` y el resto de marcadores incrementales;
- existencia y estado de `_prisma_migrations`;
- ausencia de migraciones desconocidas, fallidas o revertidas.

Solo si todo coincide registra `20260728000000_baseline_b1ca4fe` mediante `migrate resolve --applied`. Nunca resuelve `20260728010000_crm_release_candidate`: esa migración debe ejecutarse realmente con `migrate deploy`.

Si el preparador informa esquema ambiguo, no ejecutar resolve manualmente. Comparar la rama Neon con el commit histórico, revisar tablas, columnas e historial y descartar o reparar la rama mediante un procedimiento humano. Producción nunca ejecuta este baseline automático.

## Prisma P2021: falta una tabla

P2021 indica que el código consulta una tabla ausente en la base conectada. En Preview:

1. confirmar que el deployment usa su propia rama Neon;
2. comprobar que `PREVIEW_DATABASE_MIGRATIONS_ENABLED=true` está limitada a Preview;
3. revisar que `prisma migrate deploy` terminó correctamente;
4. ejecutar `prisma migrate status` contra la conexión directa del Preview;
5. ejecutar `node scripts/verify-database-schema.mjs`.

No crear la tabla con `db push` ni SQL manual. Si falta `admin_users`, debe estar aplicada `20260728010000_crm_release_candidate`.

## Prisma P2022: falta una columna

P2022 indica que el Prisma Client y la base no comparten el mismo esquema. Si falta `courses.category`, revisar la misma migración `20260728010000_crm_release_candidate`. No regenerar el cliente como sustituto de la migración: primero se aplica y verifica el SQL versionado; después se genera Prisma Client.

## Preview bloqueado antes de migrar

- Falta `PREVIEW_DATABASE_MIGRATIONS_ENABLED`: habilitarla únicamente para Preview.
- Falta `POSTGRES_PRISMA_URL`: revisar la conexión pooled asignada por la integración Neon.
- Falta `POSTGRES_URL_NON_POOLING`: revisar la conexión directa asignada por Neon.
- `VERCEL_TARGET_ENV` no es Preview: no continuar; revisar el alcance de variables y el tipo de deployment.
- La conexión directa parece pooled: corregir el alcance en la integración, sin copiar ni imprimir URLs.

## `migrate deploy` falla

Detener el Preview y revisar la migración concreta. No usar `migrate resolve` fuera del preparador salvo que una revisión humana confirme que el SQL ya existe exactamente. Solo el baseline puede resolverse; el incremental debe ejecutarse. Los índices únicos y claves foráneas pueden requerir revisar datos previos; no borrar ni fusionar registros automáticamente.

## `migrate status` o schema-check falla

No ejecutar Next.js build. Comparar las carpetas de `prisma/migrations` con `_prisma_migrations` y confirmar que la verificación usa la misma rama Neon que el runtime. El schema-check solo lee metadatos y no corrige la base.

## Build correcto pero la aplicación responde 500

Revisar primero la rama/commit y después los logs de función. Clasificar por P2021/P2022, autenticación, conexión o integración. No ocultar warnings ni incluir secretos en reportes. Un Preview nunca debe habilitar llamadas externas reales.
