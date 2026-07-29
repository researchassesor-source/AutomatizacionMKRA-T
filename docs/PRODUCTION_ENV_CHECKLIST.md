# Checklist de variables de Producción

No se guardan valores en el repositorio. Esta lista documenta nombres, finalidad y obligatoriedad.

| Variable | Clasificación | Finalidad |
|---|---|---|
| `POSTGRES_PRISMA_URL` | Obligatoria | Conexión de aplicación a PostgreSQL. |
| `POSTGRES_URL_NON_POOLING` | Obligatoria para migrar | Conexión directa para Prisma Migrate. |
| `PREVIEW_DATABASE_MIGRATIONS_ENABLED` | Prohibida en Producción | Bandera fail-closed exclusiva de Preview; debe estar ausente o en `false`. |
| `APP_URL` | Obligatoria | Origen canónico de la aplicación. |
| `SESSION_SECRET` | Obligatoria | Firma de sesiones; debe ser exclusivo y largo. |
| `ADMIN_PASSWORD` | Transición | Acceso heredado temporal; retirar tras migrar usuarios. |
| `ADMIN_LEGACY_LOGIN_ENABLED` | Transición | Control explícito del acceso heredado. |
| `CRON_SECRET` | Obligatoria si hay cron | Autoriza colas de mensajes y redes. |
| `NEXT_PUBLIC_COURSE_CATALOG_URL` | Pública | URL oficial del catálogo. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Pública opcional | Número comercial mostrado al visitante. |
| `BLOB_READ_WRITE_TOKEN` | Opcional | Carga de recursos sociales. |
| `SOCIAL_MODE` | Obligatoria | Debe iniciar en `simulation`; `live` requiere aprobación. |
| `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_IG_USER_ID`, `META_ACCESS_TOKEN` | Opcionales | Conector Meta; todos los valores requeridos dependen de la red. |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`, `TIKTOK_PRIVACY` | Opcionales | Conector TikTok. |
| `MESSAGING_MODE` | Obligatoria | Debe iniciar en `simulation`; `live` requiere aprobación. |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Opcionales | Canal de correo. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Opcionales | Canal WhatsApp Cloud API. |
| `MOODLE_WEBHOOK_SECRET` | Opcional | Autoriza finalizaciones desde Moodle; vacía mantiene 401. |
| `FINANCE_MODE` | Obligatoria | Debe iniciar en `simulation`; `live` requiere contrato aprobado. |
| `FINANCE_API_URL`, `FINANCE_APP_URL`, `FINANCE_USER`, `FINANCE_PASS`, `FINANCE_SERVICE_NAME` | Opcionales | Handoff y verificación con Finance. |

`CRM_ADMIN_PASSWORD` es una variable efímera usada solo por `npm run admin:create`; no debe persistirse en el proveedor. `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET` y `FINANCE_AUTO_EMIT` no son variables operativas de este código.

`POSTGRES_PRISMA_URL` es la conexión pooled de runtime. `POSTGRES_URL_NON_POOLING` es la conexión directa declarada como `directUrl` en Prisma. En Preview ambas deben pertenecer a la rama Neon aislada; nunca se copian desde Producción. El build de Producción valida y genera Prisma Client, pero no ejecuta `migrate deploy`.

Verificar por nombre y presencia, nunca imprimir valores. Preview y Producción deben usar bases, secretos, cuentas y cron diferentes.
