# Migración progresiva a Producción

El historial empieza con `20260728000000_baseline_b1ca4fe` y continúa con `20260728010000_crm_release_candidate`. La segunda migración es aditiva: conserva `Lead.courseId` y `Lead.financeInscripcionId`, crea inscripciones históricas y no elimina tablas ni columnas. Nunca se usa `prisma db push` ni `prisma migrate dev` contra Producción.

## Preflight obligatorio

1. Confirmar PostgreSQL compatible, espacio disponible y ventana de mantenimiento.
2. Crear un respaldo verificable y ensayar su restauración en una base aislada.
3. Comparar el esquema productivo con la migración base. Solo se marca la base como aplicada si coincide realmente con `b1ca4fe`.
4. Ejecutar consultas de solo lectura para detectar referencias Finance repetidas, relaciones de curso huérfanas y duplicados potenciales de mensajes:

```sql
SELECT "financeInscripcionId", count(*)
FROM "leads"
WHERE "financeInscripcionId" IS NOT NULL
GROUP BY "financeInscripcionId"
HAVING count(*) > 1;

SELECT l."id", l."courseId"
FROM "leads" l
LEFT JOIN "courses" c ON c."id" = l."courseId"
WHERE l."courseId" IS NOT NULL AND c."id" IS NULL;

SELECT "leadId", "sequenceKey", "stepKey", count(*)
FROM "outbound_messages"
WHERE "sequenceKey" IS NOT NULL AND "stepKey" IS NOT NULL
GROUP BY "leadId", "sequenceKey", "stepKey"
HAVING count(*) > 1;
```

Las referencias Finance repetidas se conservan en `leads` pero no se copian a `enrollments`. Cualquier otro resultado inesperado se revisa manualmente; no se borra ni fusiona información de forma automática.

## Base existente en b1ca4fe

Con la URL no agrupada configurada en el entorno autorizado:

```bash
npx prisma validate
npx prisma migrate diff --from-url "$POSTGRES_URL_NON_POOLING" --to-migrations prisma/migrations --shadow-database-url "$SHADOW_DATABASE_URL"
npx prisma migrate resolve --applied 20260728000000_baseline_b1ca4fe
npx prisma migrate deploy
npx prisma migrate status
```

El `resolve` no ejecuta SQL: registra una base ya existente. No debe usarse si el esquema no coincide con la base. El resultado de `migrate diff` y el SQL incremental deben aprobarse antes del despliegue.

## Base vacía

En una base nueva y aislada basta con:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Se aplican la base y la expansión en orden. Las semillas solo se permiten fuera de Producción.

## Verificación posterior

- Comparar conteos de contactos con curso histórico e inscripciones creadas.
- Verificar una muestra de etapa, curso y referencia Finance sin imprimir datos personales.
- Confirmar que `prisma migrate status` indique esquema actualizado.
- Mantener `FINANCE_MODE`, `SOCIAL_MODE` y `MESSAGING_MODE` en `simulation`.
- Crear al menos un usuario individual antes de retirar el acceso heredado.

El procedimiento de reversión está en `ROLLBACK.md`. Los campos históricos se retirarán, si corresponde, en otra migración independiente.
