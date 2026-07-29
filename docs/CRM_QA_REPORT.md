# Informe de cierre integral del CRM

Fecha de corte: 2026-07-29. Rama auditada: `feature/optimizacion-crm-cursos-leads`. PR de referencia: #8.

Decisión: **GO PARA NUEVO PREVIEW**. Esta decisión no autoriza Producción. Producción permanece bloqueada hasta completar catálogo, administrador individual, respaldo, migración controlada, revisión humana, smoke test, rollback y autorización expresa.

## Resultado por módulo

| Módulo | Ruta | Problema encontrado | Severidad | Causa | Corrección | Archivo principal | Prueba | Resultado | Riesgo restante |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login | `/admin/login` | Mensajes incompletos, sesión vencida y cuenta desactivada sin estado claro | P1 | Respuestas genéricas y ausencia de contexto de sesión | Respuestas seguras 401/403/429/503, aviso de expiración y aviso de sesión heredada | `src/app/api/admin/login/route.ts` | Smoke de login individual, credencial inválida, revocación y logout; seis anchos | Aprobado | Retirar acceso heredado solo después de validar un ADMIN individual en Producción |
| Resumen | `/admin` | Enlaces visibles para roles sin acceso y métricas sin fecha de corte | P1 | Presentación no filtraba permisos | Tarjetas y accesos filtrados por rol; fecha de actualización | `src/app/admin/page.tsx` | Matriz de roles y revisión responsive | Aprobado | Definiciones operativas deben mantenerse documentadas si cambian reglas |
| Contactos | `/admin/leads` | Alta duplicada y borrado con riesgo de historial | P0 | Sin control de identidad en alta manual y DELETE físico | Duplicados por WhatsApp/correo, WhatsApp normalizado, correo opcional y archivado lógico | `src/app/api/admin/leads/route.ts` | Smoke alta/conflicto/archivo/restauración | Aprobado | La fusión manual de duplicados históricos queda fuera de alcance |
| Detalle | `/admin/leads/[id]` | Acciones sensibles parciales y auditoría relacionada ausente | P0/P1 | Flujo histórico incompleto | Confirmaciones, motivo de pérdida, validación de identidad, sin borrado físico y eventos de auditoría relacionados | `src/app/api/admin/leads/[id]/route.ts` | Smoke notas, seguimiento, etapas y preservación | Aprobado | Sin herramienta de fusión de contactos |
| Seguimientos | `/admin/seguimientos` | Completar, cancelar o reprogramar sin confirmación | P1 | Mutación directa desde UI/API | Confirmación obligatoria y auditoría por acción | `src/app/api/admin/followups/[id]/route.ts` | Smoke de creación y finalización | Aprobado | Alta global continúa desde el detalle del contacto; mejora P2 futura |
| Ventas | `/admin/ventas` | Puntaje sin documento y cierres sin confirmación/motivo | P1 | Reglas implícitas | Regla documentada, confirmación de recálculo/transición y motivo obligatorio al perder | `src/app/api/admin/leads/stage/route.ts` | Pruebas de scoring y smoke de pipeline | Aprobado | Monto y fecha formal de cierre no existen en el modelo actual; P2 de producto |
| Cursos | `/admin/cursos` | Preview histórico no representa el catálogo oficial; eliminación física posible | P0 | Sin proceso de conciliación | Snapshot de 11 cursos, comparador, importación idempotente confirmada, bloqueo en Producción y desactivación sin borrado | `src/app/api/admin/courses/catalog/route.ts` | Pruebas de catálogo, migración/seed en BD aislada y revisión visual | Aprobado | No se ejecutó importación en Preview; discrepancia de nombre/slug del primer curso requiere revisión humana |
| Finance | `/admin/certificados` | Acción podía parecer definitiva y contrato de estados incompleto | P1 | Handoff embebido en Enrollment | Confirmación explícita; solo preparación/simulación; CRM no emite certificados | `src/app/api/admin/enrollments/[id]/complete/route.ts` | Smoke de finalización e idempotencia | Aprobado en simulación | Confirmar contrato externo y estados recibido/procesado/rechazado antes de Producción |
| Mensajes | `/admin/mensajes` | Despacho masivo y reintentos sin confirmación suficiente | P0/P1 | Controles operativos incompletos | Resumen, confirmación, auditoría, validación por canal/variables y edición/duplicado/desactivación de plantillas | `src/app/api/admin/nurture/dispatch/route.ts` | Smoke de cola simulada y pruebas de integraciones | Aprobado en simulación | Proveedor real no probado por restricción de QA |
| Redes | `/admin/redes` | Riesgo de publicación/upload real; cuentas podían borrarse | P0 | Preview no bloqueaba toda salida y faltaba ciclo de recurrencia | Simulación obligatoria, upload bloqueado, confirmaciones, soft-delete y editar/pausar/reactivar/archivar recurrencias | `src/app/api/admin/social/publish/route.ts` | Smoke de cuenta, post, publicación y recurrencia simuladas | Aprobado en simulación | Fin de recurrencia y vínculo con curso no existen aún; P2 |
| Usuarios | `/admin/usuarios` | Gestión incompleta y acciones sin confirmación | P1 | UI mínima | Búsqueda/filtros, explicación de roles, fechas, editar perfil, resetear contraseña, confirmaciones y estado en curso | `src/app/admin/usuarios/UserManager.tsx` | Smoke de matriz de roles y revocación; revisión a11y | Aprobado | Validar ADMIN individual real antes de retirar login heredado |
| Auditoría | `/admin/auditoria` | Metadatos anidados podían exponer datos y textos técnicos | P0/P1 | Sanitización superficial | Sanitización recursiva, límites, traducciones y detalle seguro del evento | `src/lib/audit.ts` | Pruebas de sanitización y smoke de acciones | Aprobado | Conservar revisión de nuevas claves sensibles al ampliar integraciones |
| Navegación | Sidebar/topbar | Enlaces no autorizados y estado heredado oculto | P1 | Permisos visuales dispersos | Navegación por rol, aviso heredado, drawer con Escape, trap y retorno de foco | `src/app/admin/AdminNav.tsx` | Matriz de roles y prueba móvil de teclado | Aprobado | Ninguno bloqueante |
| Formularios públicos | `/`, `/cursos/[slug]`, `/gracias`, `/api/leads` | Captura se presentaba como inscripción y creaba estado incorrecto | P0 | Interés e inscripción se trataban como equivalentes | Registro como `INTERESADO`, etapa preservada/NUEVO, correo opcional, deduplicación y mensaje/redirección honestos | `src/app/api/leads/route.ts` | Smoke público idempotente y revisión de cuatro rutas a seis anchos | Aprobado | `Enrollment` se reutiliza como relación de interés por compatibilidad del modelo |
| Moodle | `/api/moodle/completion` | Secreto enviado como cabecera sin firma del cuerpo | P0 | Autenticación de webhook débil | HMAC SHA-256 sobre cuerpo crudo, comparación constante, límite 16 KiB e idempotencia | `src/app/api/moodle/completion/route.ts` | Pruebas HMAC y smoke con payload firmado ficticio | Aprobado | Moodle real no fue llamado; acordar encabezado con el emisor antes de Producción |
| Seguridad/APIs | `/api/admin/*` | CSRF insuficiente, uploads reales en Preview y acciones sensibles no confirmadas | P0 | Controles no uniformes | Verificación same-origin, roles, body limits existentes, bloqueo Blob y confirmaciones/auditoría | `src/lib/auth/authorization.ts` | Pruebas CSRF, matriz de roles, smoke de rutas y guardas cron | Aprobado | Rate limit en memoria no es distribuido; P2 de infraestructura |
| Base de datos | `prisma/schema.prisma` | Curso sin modalidad/fechas; historial vulnerable por APIs de borrado | P0/P1 | Campos ausentes y uso de deletes | Migración aditiva nullable; APIs preservan historial; prueba solo en BD temporal | `prisma/migrations/20260729010000_course_schedule_fields/migration.sql` | `prisma validate` y `migrate deploy` desde cero en BD QA | Aprobado | Base local heredada presenta P3005 por ausencia de historial de migraciones; requiere baseline controlado separado |
| Responsive/a11y | Todas | Controles compactos, labels puntuales y foco de diálogos | P2 | Inconsistencias visuales acumuladas | Objetivos táctiles de 44 px, labels, semántica, foco/retorno, Escape y reduced motion | `src/app/globals.css` | 84 combinaciones ruta×ancho; drawer y diálogo por teclado | Aprobado | Validación humana adicional con lector de pantalla recomendada |

## Calificación

| Módulo | Nota / 10 | Módulo | Nota / 10 |
| --- | ---: | --- | ---: |
| Login | 9.2 | Resumen | 9.0 |
| Contactos | 9.2 | Detalle | 9.0 |
| Seguimientos | 8.5 | Ventas | 8.7 |
| Cursos | 9.0 | Finance | 8.2 |
| Mensajes | 8.8 | Redes | 8.4 |
| Usuarios | 9.0 | Auditoría | 9.0 |
| Navegación | 9.2 | Seguridad | 9.0 |
| Responsive | 9.1 | Integración pública | 9.2 |

## Evidencia técnica

- `npm ci`: aprobado; 144 paquetes instalados y 0 vulnerabilidades reportadas.
- `npx prisma validate`: aprobado.
- `npm run typecheck`: aprobado.
- `npm test`: 12 archivos, 84 pruebas aprobadas.
- `npm run lint`: código 0; 19 advertencias preexistentes no bloqueantes, sin errores.
- `npm run build`: aprobado; 17/17 páginas estáticas generadas y rutas dinámicas compiladas.
- `npm run smoke:release`: código 0; nueve grupos de flujo aprobados y `cleanup: ok`.
- `git diff --check`: código 0, sin salida.
- Responsive: 10 rutas administrativas y 4 públicas en 1440, 1280, 1024, 768, 390 y 360 px; 84 combinaciones sin overflow global, acciones menores a 44 px, tablas fuera de su contenedor ni contenido principal ausente.
- Accesibilidad: un `h1` por ruta, `lang=es`, controles con nombre accesible, drawer y diálogo operables por teclado, Escape y retorno de foco comprobados.

## Datos, migraciones y limpieza

Se creó la base local desechable `mkra_codex_qa_20260729`. En ella se aplicaron las tres migraciones desde cero, se cargó el catálogo y se ejecutaron fixtures con correos `.example.test`. El smoke eliminó sus cinco usuarios, dos contactos, un curso y una cuenta social, además de datos relacionados. La base completa fue eliminada al terminar la auditoría.

La única migración nueva es aditiva: `20260729010000_course_schedule_fields`; agrega `modality`, `startsAt` y `endsAt` como campos opcionales de `Course`. No se alteraron migraciones aplicadas, Preview ni Producción.

## Pendientes y límites

- P0 abiertos: ninguno para crear un nuevo Preview.
- P1 abiertos: confirmar con Finance el contrato de estados y con Moodle el encabezado HMAC; ambos requieren coordinación externa y permanecen bloqueados para Producción.
- P2 abiertos: fecha fin/curso en recurrencias, rate limit distribuido, alta global de seguimiento, campos explícitos de monto/cierre y prueba con lector de pantalla.
- Advertencias de lint: 19 preexistentes y no bloqueantes; corresponden a aserciones TypeScript ya protegidas, especificidad CSS, `!important` de accesibilidad y una sugerencia de optional chaining. Las advertencias nuevas detectadas durante la auditoría fueron corregidas. No hay errores de lint.

## Restricciones respetadas

No se modificó `.env`, no se usaron secretos reales, no se llamó Moodle real, no se enviaron mensajes, no se publicaron redes, no se emitieron certificados, no se ejecutó el importador en Preview, no se tocaron variables Vercel y no hubo commit, push, merge, despliegue ni operación sobre Producción.

## Manifiesto del worktree

Archivos modificados (64):

- Documentación y esquema: `docs/INTEGRACION_MOODLE.md`, `docs/PRUEBAS_MANUALES_CRM.md`, `prisma/schema.prisma`, `scripts/release-smoke.ts`.
- Panel: `src/app/admin/AdminNav.tsx`, `src/app/admin/adminPresentation.ts`, `src/app/admin/auditoria/page.tsx`, `src/app/admin/certificados/FinanceAction.tsx`, `src/app/admin/cursos/CourseManager.tsx`, `src/app/admin/cursos/page.tsx`, `src/app/admin/leads/[id]/LeadDetailManager.tsx`, `src/app/admin/leads/[id]/page.tsx`, `src/app/admin/login/page.tsx`, `src/app/admin/mensajes/DispatchButton.tsx`, `src/app/admin/mensajes/MessageActions.tsx`, `src/app/admin/mensajes/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/redes/RedesManager.tsx`, `src/app/admin/redes/page.tsx`, `src/app/admin/seguimientos/FollowUpActions.tsx`, `src/app/admin/usuarios/UserManager.tsx`, `src/app/admin/usuarios/page.tsx`, `src/app/admin/ventas/VentasManager.tsx`, `src/app/admin/ventas/page.tsx`.
- APIs: `src/app/api/admin/courses/[id]/route.ts`, `src/app/api/admin/enrollments/[id]/complete/route.ts`, `src/app/api/admin/enrollments/route.ts`, `src/app/api/admin/followups/[id]/route.ts`, `src/app/api/admin/leads/[id]/route.ts`, `src/app/api/admin/leads/route.ts`, `src/app/api/admin/leads/stage/route.ts`, `src/app/api/admin/login/route.ts`, `src/app/api/admin/messages/[id]/route.ts`, `src/app/api/admin/nurture/dispatch/route.ts`, `src/app/api/admin/scoring/recompute/route.ts`, `src/app/api/admin/social/accounts/[id]/route.ts`, `src/app/api/admin/social/posts/[id]/route.ts`, `src/app/api/admin/social/publish/route.ts`, `src/app/api/admin/templates/[id]/route.ts`, `src/app/api/admin/templates/route.ts`, `src/app/api/admin/upload/route.ts`, `src/app/api/admin/upload/token/route.ts`, `src/app/api/leads/route.ts`, `src/app/api/moodle/completion/route.ts`.
- Sitio público: `src/app/cursos/[slug]/LeadForm.tsx`, `src/app/globals.css`, `src/app/gracias/page.tsx`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/verificar/[folio]/page.tsx`, `src/app/verificar/page.tsx`.
- Datos y librerías: `src/data/courses.ts`, `src/lib/audit.ts`, `src/lib/auth/authorization.test.ts`, `src/lib/auth/authorization.ts`, `src/lib/auth/server.ts`, `src/lib/course-validation.test.ts`, `src/lib/course-validation.ts`, `src/lib/http.ts`, `src/lib/integrations.test.ts`, `src/lib/leads.ts`, `src/lib/moodle.ts`, `src/lib/time.test.ts`, `src/lib/time.ts`.

Archivos creados (15):

- `docs/COURSE_CATALOG_AUDIT.md`
- `docs/CRM_AUDIT_MATRIX.md`
- `docs/CRM_QA_REPORT.md`
- `docs/SCORING_CRM.md`
- `prisma/migrations/20260729010000_course_schedule_fields/migration.sql`
- `scripts/qa-database.ts`
- `src/app/admin/cursos/CourseCatalogAudit.tsx`
- `src/app/admin/mensajes/TemplateActions.tsx`
- `src/app/api/admin/courses/catalog/route.ts`
- `src/app/api/admin/social/schedules/[id]/route.ts`
- `src/lib/audit.test.ts`
- `src/lib/course-catalog-server.ts`
- `src/lib/course-catalog.test.ts`
- `src/lib/course-catalog.ts`
- `src/lib/scoring.test.ts`
