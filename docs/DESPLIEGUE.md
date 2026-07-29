# Despliegue controlado

Esta guía separa desarrollo local, Preview y Producción. No se debe ejecutar ningún cambio productivo sin respaldo, revisión del SQL y aprobación administrativa.

## Preview

1. Revisar la rama y el diff completo.
2. Crear una base PostgreSQL aislada para Preview.
3. Configurar secretos distintos de Producción.
4. Mantener `FINANCE_MODE=simulation` y `SOCIAL_MODE=simulation`.
5. Crear usuarios de prueba con datos ficticios.
6. Ejecutar la matriz de `PRUEBAS_MANUALES_CRM.md`.
7. Confirmar responsive, permisos, auditoría y ausencia de llamadas externas.

## Producción

1. Aplicar la estrategia de `MIGRACION_PRODUCCION.md`.
2. Crear `SESSION_SECRET` y `CRON_SECRET` largos y exclusivos.
3. Crear usuarios individuales y retirar gradualmente el acceso compartido.
4. Mantener Finance y redes en simulación hasta validar cuentas, permisos y contratos.
5. Cambiar un modo a `live` solamente después de una aprobación separada.
6. Programar llamadas `GET` autenticadas a los procesos de mensajes y publicaciones.
7. Verificar telemetría, auditoría, rollback y copias de seguridad.

## Variables

La lista se mantiene en `.env.example`. Nunca se documentan valores reales. No existe una variable de autoemisión de certificados.
