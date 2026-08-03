# Plan de endurecimiento compatible del CRM

## Límite distribuido

En Vercel, el CRM usa PostgreSQL para contabilizar límites en `rate_limit_buckets`; la clave de red se guarda como SHA-256 y no como dirección IP legible. En desarrollo local se conserva el respaldo en memoria. Si la base no está disponible, se aplica temporalmente el límite local y se registra un error sin datos personales.

## Acceso heredado

El acceso heredado no se desactiva en esta fase. Antes de desactivarlo se debe:

1. confirmar al menos una cuenta `ADMIN` individual activa;
2. revisar auditorías `AUTH_LOGIN_LEGACY` de los últimos 90 días;
3. identificar a las personas que todavía ingresan sin correo;
4. asignarles cuentas y roles individuales;
5. invalidar sesiones heredadas mediante rotación autorizada de `SESSION_SECRET`;
6. establecer `ADMIN_LEGACY_LOGIN_ENABLED=false` y comprobar el acceso individual;
7. retirar `ADMIN_PASSWORD` solamente en una ventana posterior autorizada.

No se imprimen valores de variables en estas comprobaciones.

## Tokens sociales históricos

`social_accounts.accessToken` se conserva para compatibilidad de esquema, pero las APIs administrativas no aceptan ni escriben tokens. Los conectores leen secretos únicamente desde variables del entorno. La eliminación futura de la columna requiere comprobar primero que está vacía, respaldar la base, desplegar una migración aditiva de transición y retirar la columna en una release posterior.

## Webhooks de proveedores

Los modelos almacenan IDs y eventos sanitizados. Correo, WhatsApp y TikTok no deben activarse como reales hasta disponer de firma de webhook validada, pruebas controladas y confirmación humana del resultado en el proveedor.
