# Checklist de despliegue

## Antes de Preview

- [ ] Rama y commit exactos aprobados; worktree limpio.
- [ ] Base PostgreSQL nueva y exclusiva para Preview.
- [ ] Variables propias de Preview, sin secretos ni URLs privadas de Producción.
- [ ] `FINANCE_MODE=simulation`, `SOCIAL_MODE=simulation` y `MESSAGING_MODE=simulation`.
- [ ] Migraciones aplicadas con `prisma migrate deploy`; nunca `db push`.
- [ ] Usuario ADMIN ficticio creado con `CRM_ADMIN_PASSWORD` solo en la sesión del comando.
- [ ] Matriz funcional, responsive, accesibilidad, consola y red aprobadas.
- [ ] Datos ficticios retirados y auditoría revisada sin secretos.

## Antes de Producción

- [ ] Respaldo reciente restaurado y verificado en un entorno aislado.
- [ ] Preflight y SQL de `MIGRACION_PRODUCCION.md` aprobados.
- [ ] Ventana, responsables, monitoreo y criterio de abortar definidos.
- [ ] Variables obligatorias verificadas por nombre y alcance, sin imprimir valores.
- [ ] `SESSION_SECRET` y `CRON_SECRET` exclusivos, largos y rotables.
- [ ] Usuario individual ADMIN probado; plan de retiro del acceso heredado aprobado.
- [ ] Integraciones continúan en simulación para el primer despliegue.
- [ ] Rollback ensayado; no hay cambios destructivos pendientes.

## Despliegue

- [ ] Ejecutar `npx prisma migrate deploy` una sola vez con conexión no agrupada.
- [ ] Confirmar `npx prisma migrate status`.
- [ ] Desplegar el commit aprobado, sin ejecutar semillas.
- [ ] Probar login, permisos, contactos, dos inscripciones por contacto, agenda y auditoría.
- [ ] Confirmar que mensajes, redes y Finance siguen simulados.
- [ ] Vigilar errores sin registrar datos personales ni secretos.

## Activación posterior de integraciones

Cada cambio a `live` requiere una aprobación y una ventana separadas. Validar un proveedor a la vez en una cuenta de prueba, con límites, observabilidad, reversión a `simulation` y confirmación de que no existe ninguna ruta de emisión de certificados.
