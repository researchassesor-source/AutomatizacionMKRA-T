# Qué valida realmente cada comando de migración

Corrección de una afirmación incorrecta del informe del 6 de agosto de 2026:
se dijo que el despliegue de Preview valida la migración «mediante shadow
database». **Es falso.** Ningún comando del pipeline crea ni usa una base
temporal. Este documento describe qué detecta cada pieza y qué no.

## `prisma migrate deploy`

Aplica los archivos `migration.sql` que aún no constan en la tabla
`_prisma_migrations`, en orden, y registra cada uno.

- **Detecta:** un `migration.sql` con SQL inválido (falla al ejecutarlo).
- **No detecta:** deriva entre `schema.prisma` y la estructura real. No lee el
  datamodel; solo ejecuta SQL.
- **No usa shadow database.** `prisma migrate deploy --help` no expone
  `--shadow-database-url`; la opción no existe para este comando.

Si la migración escrita a mano no corresponde al `schema.prisma`, `deploy`
la aplica igual y termina con éxito. La aplicación fallaría después, en
tiempo de ejecución, al consultar una columna que Prisma cree que existe.

## `prisma migrate status`

Compara el historial `_prisma_migrations` contra la carpeta `prisma/migrations`.

- **Detecta:** migraciones pendientes, migraciones aplicadas que ya no están en
  el repositorio, y migraciones fallidas o revertidas.
- **No detecta:** deriva de datamodel. Compara *historial*, no *estructura*.
- **No usa shadow database.** Tampoco expone `--shadow-database-url`.

## `scripts/verify-database-schema.mjs`

Script propio del repositorio. Consulta `information_schema` y la tabla de
historial.

- **Detecta:** ausencia de alguna tabla o columna de su lista explícita
  (`REQUIRED_TABLES`, `REQUIRED_COLUMNS`), migraciones incompletas, revertidas,
  ajenas al repositorio o faltantes.
- **No detecta:** columnas de más, tipos de dato incorrectos, valores por
  defecto distintos, índices ausentes, claves foráneas ausentes o con la regla
  `ON DELETE` equivocada, ni restricciones únicas ausentes.
- Es una lista de comprobación por inclusión, mantenida a mano. Lo que no esté
  en la lista no se comprueba.

## `scripts/vercel-build.mjs`

| Entorno | Qué ejecuta |
| --- | --- |
| **Preview** | `validate` → `prepare-preview-migrations` → `migrate deploy` → `migrate status` → `generate` → `verify-database-schema` → `next build` |
| **Producción** | `validate` → `generate` → `next build`. **Sin migraciones.** |
| Desarrollo | `generate` → `next build` |

`prisma validate` comprueba únicamente que `schema.prisma` sea sintáctica y
semánticamente correcto. No consulta la base.

## Conclusión operativa

Preview sí es un buen ensayo: ejecuta la migración de verdad contra una base
aislada y confirma que el SQL corre y que las estructuras de la lista aparecen.
**Eso no equivale a comprobar que la migración reproduce el `schema.prisma`.**

## Cómo se comprueba la deriva de verdad

El único comando que compara migraciones contra datamodel es `migrate diff`, y
es el único que pide una base temporal:

```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DB" --exit-code
```

`$SHADOW_DB` debe ser una base PostgreSQL vacía y descartable, **nunca**
Preview ni Producción: el comando la crea y destruye estructuras a voluntad.

Códigos de salida: `0` sin diferencias, `2` hay deriva. Con `--script` en lugar
de `--exit-code` imprime el SQL que faltaría.

Hoy este paso **no** está en el pipeline porque no hay una base descartable
aprovisionada. Se ejecuta a mano cuando se escribe una migración manualmente,
como la de sesiones de curso.
