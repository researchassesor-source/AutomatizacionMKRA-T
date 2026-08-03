# Entorno Preview aislado

## Flujo permanente

Cada deployment Preview obtiene una rama de Neon independiente mediante Preview Branching. Vercel ejecuta `npm run vercel-build`, definido como fuente de verdad en `vercel.json`. El script detecta `VERCEL_ENV` y actúa de forma cerrada:

1. exige `VERCEL_ENV=preview` y `PREVIEW_DATABASE_MIGRATIONS_ENABLED=true`;
2. valida la presencia de `POSTGRES_PRISMA_URL` y `POSTGRES_URL_NON_POOLING` sin imprimirlas;
3. ejecuta `prisma validate`;
4. ejecuta `prepare-preview-migrations.mjs`, que inspecciona tablas, columnas e historial Prisma en modo de solo lectura;
5. si reconoce exactamente el esquema histórico sin historial, marca únicamente `20260728000000_baseline_b1ca4fe` como aplicada;
6. aplica migraciones pendientes con `prisma migrate deploy`;
7. exige que `prisma migrate status` apruebe;
8. genera Prisma Client;
9. verifica en modo de solo lectura las tablas críticas, todas las carpetas de migración versionadas y las columnas de catálogo, agenda y captación;
10. ejecuta `next build`.

Cualquier error detiene el deployment. El flujo no contiene `seed`, `db push`, `migrate dev` ni `migrate reset`.

Producción sigue otro camino: valida Prisma, genera el cliente y compila, pero no ejecuta migraciones automáticas. Local conserva el build normal sin migraciones inesperadas. Un valor desconocido de `VERCEL_ENV` se rechaza.

## Baseline de ramas copiadas

Neon puede crear un Preview copiando una rama que ya contiene el esquema histórico, pero sin una fila compatible en `_prisma_migrations`. Prisma responde P3005 porque la base no está vacía y no puede ejecutar nuevamente el SQL del baseline.

El preparador admite únicamente estos estados:

1. **Base vacía:** no ejecuta `migrate resolve`; `migrate deploy` aplica baseline e incremental.
2. **Baseline histórico exacto sin historial:** comprueba las seis tablas históricas y todas sus columnas, rechaza cualquier estructura incremental o desconocida y registra únicamente `20260728000000_baseline_b1ca4fe`.
3. **Baseline ya registrado:** no repite resolve; deja que deploy aplique las migraciones incrementales.
4. **Secuencia parcial válida:** reconoce baseline, release y agenda aplicados en orden; `migrate deploy` aplica las migraciones posteriores pendientes.
5. **Todas las migraciones registradas:** exige también las columnas finales y confirma el estado sin ejecutar `migrate resolve`.
6. **Esquema parcial, ambiguo o con historial desconocido:** detiene el build antes de resolve y deploy.
7. **Producción:** el preparador no se ejecuta y además rechaza una invocación directa.

Solo `20260728000000_baseline_b1ca4fe` puede marcarse automáticamente. `20260728010000_crm_release_candidate`, `20260729010000_course_schedule_fields`, `20260803010000_course_capture_campaign` y cualquier migración futura deben ejecutarse realmente mediante `prisma migrate deploy`. Los nombres válidos se descubren desde `prisma/migrations`; cualquier registro ajeno, fallido, revertido, incompleto o fuera de orden bloquea el build.

## Variables de Preview

Solo se enumeran nombres; los valores se administran en Vercel y Neon.

### Obligatorias para build

- `POSTGRES_PRISMA_URL`: conexión pooled de runtime a la rama Neon del Preview.
- `POSTGRES_URL_NON_POOLING`: conexión directa a la misma rama, usada por Prisma Migrate y la verificación.
- `PREVIEW_DATABASE_MIGRATIONS_ENABLED=true`: autorización explícita, exclusiva de Preview.

### Obligatorias para login

- `SESSION_SECRET`.
- `ADMIN_PASSWORD` y `ADMIN_LEGACY_LOGIN_ENABLED=true`, solo durante la transición si se usa el acceso heredado.

El acceso heredado acepta contraseña sin correo, no crea `AdminUser` y registra auditoría. Se desactiva con `ADMIN_LEGACY_LOGIN_ENABLED=false` después de crear usuarios individuales.

### Obligatorias para runtime según funciones activadas

- `APP_URL`.
- `CRON_SECRET` si se prueban endpoints programados.
- `BLOB_READ_WRITE_TOKEN` si se prueban cargas.

### Opcionales o desactivadas

- `FINANCE_MODE=simulation`.
- `SOCIAL_MODE=simulation`.
- `MESSAGING_MODE=simulation`.
- Variables `FINANCE_*`, `META_*`, `TIKTOK_*`, `EMAIL_*`, `WHATSAPP_*` y `MOODLE_WEBHOOK_SECRET` solo si se prueba su configuración aislada.

Aunque una variable `*_MODE` se configure accidentalmente como `live`, `VERCEL_ENV=preview` fuerza simulación en Finance, mensajería y redes. `FINANCE_AUTO_EMIT` no es una variable operativa del CRM; debe permanecer ausente o `false` en configuraciones heredadas. El webhook Moodle es entrante, exige firma y no llama Moodle. Los cron exigen `CRON_SECRET`.

## Acceso administrativo

La primera validación debe usar el acceso heredado temporal, sin copiar usuarios ni contraseñas locales. Para crear posteriormente un administrador individual se ejecuta manualmente:

```powershell
$env:CRM_ADMIN_PASSWORD="valor-temporal-seguro"
npm run admin:create -- --email=qa-admin@example.test --name="Administrador QA"
Remove-Item Env:CRM_ADMIN_PASSWORD
```

El comando es idempotente y nunca forma parte del build. La contraseña no debe persistirse, imprimirse ni guardarse en Git.

## Validación de un Preview

1. Confirmar rama y commit del deployment.
2. Revisar logs y localizar, en orden, validate, preview-baseline, migrate deploy, migrate status, generate, schema-check y next build.
3. Abrir `/` y `/admin/login`.
4. Confirmar protección de `/admin` sin sesión.
5. Probar dashboard, Contactos, Cursos, Seguimientos, Ventas, Mensajes, Redes, Finance, Usuarios y Auditoría sin enviar ni publicar contenido.
6. Revisar logs: cero P2021, P2022, respuestas 500 o conexiones externas reales.
7. Eliminar fixtures identificados como QA si se crearon.

## Ciclo de vida de ramas Neon

Neon crea una rama por Preview y Vercel la vincula al deployment. Estas ramas no deben almacenar datos reales. Cerrar un PR o borrar un deployment puede no eliminar inmediatamente su rama por políticas de retención; se deben revisar periódicamente Vercel y Neon y eliminar manualmente ramas abandonadas solo mediante el procedimiento autorizado. Este flujo no elimina ramas ni deployments automáticamente.

## Preparación posterior de Producción

Producción permanece en NO-GO hasta contar con respaldo restaurado, revisión humana del SQL, variables verificadas, administrador individual, ventana aprobada y estrategia de rollback ensayada. Las migraciones productivas se ejecutan manualmente con conexión directa siguiendo `MIGRACION_PRODUCCION.md`.
