# Seguridad del CRM

## Acceso

- Usuarios individuales con hash `scrypt`.
- Sesión HMAC firmada, expiración de ocho horas y cookie `httpOnly`.
- `secure` en Producción y `sameSite=lax`.
- Rate limiting en login y mensajes genéricos.
- Roles validados en el servidor.
- Logout elimina la cookie.

## Permisos

- `ADMIN`: usuarios, auditoría, eliminación definitiva y Finance.
- `MARKETING`: cursos, plantillas, mensajes y redes.
- `VENTAS`: contactos, notas, seguimientos, pipeline y mensajes.
- `LECTURA`: consultas sin acciones destructivas.

## Datos

- WhatsApp normalizado a formato internacional Ecuador.
- Consentimiento, fecha, versión, finalidad y origen.
- Auditoría sin contraseñas, hashes, tokens ni secretos.
- Exportación limitada a contactos activos y consentidos.
- Eliminación definitiva solo para ADMIN y con nombre exacto.

## Integraciones

- Automatizaciones cerradas por defecto en Producción si falta secreto.
- Redes y Finance simulados en local.
- Moodle deshabilitado sin secreto.
- Solo conectores oficiales.
