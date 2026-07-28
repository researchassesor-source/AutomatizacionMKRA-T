# Integración Moodle

## Flujo manual

Un ADMIN abre la inscripción, confirma la finalización y el CRM registra el evento. Después se prepara el envío a Finance; no se emite ningún certificado.

## Webhook futuro

Ruta: `POST /api/moodle/completion`.

Cabecera requerida: `x-moodle-webhook-secret`.

Cuerpo esperado:

```json
{
  "eventId": "identificador-idempotente",
  "enrollmentId": "inscripcion-unica-del-crm",
  "email": "persona@example.test",
  "courseSlug": "curso-confirmado",
  "moodleEnrollmentId": "opcional"
}
```

El servidor localiza exclusivamente por `enrollmentId` y verifica que correo, curso y referencia Moodle coincidan. `eventId` es idempotente: repetirlo para otra inscripción responde conflicto. Si `MOODLE_WEBHOOK_SECRET` está vacío, responde 401. La URL, el secreto y el contrato reales continúan pendientes de confirmación externa.
