# Integración Moodle

## Flujo manual

Un ADMIN abre la inscripción, confirma la finalización y el CRM registra el evento. Después se prepara el envío a Finance; no se emite ningún certificado.

## Webhook futuro

Ruta: `POST /api/moodle/completion`.

Cabecera requerida: `x-moodle-signature`, con el formato `sha256=<hexadecimal>`.

La firma se calcula sobre los bytes UTF-8 exactos del cuerpo JSON:

```text
HMAC-SHA256(MOODLE_WEBHOOK_SECRET, cuerpo_sin_modificar)
```

El emisor no debe volver a serializar ni alterar espacios del cuerpo después de calcularla. El CRM compara la firma en tiempo constante y rechaza cuerpos alterados, firmas ausentes o secretos no configurados con HTTP 401. El cuerpo se limita a 16 KiB.

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

El servidor localiza exclusivamente por `enrollmentId` y verifica que correo, curso y referencia Moodle coincidan. `eventId` es idempotente: repetirlo para otra inscripción responde conflicto. Si `MOODLE_WEBHOOK_SECRET` está vacío, responde 401. El CRM solo recibe el evento y no llama a Moodle. La URL y el secreto reales continúan pendientes de confirmación externa.
