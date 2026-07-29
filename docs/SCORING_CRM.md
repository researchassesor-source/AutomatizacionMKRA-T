# Puntaje comercial del CRM

El puntaje prioriza contactos; no confirma una venta, no crea inscripciones y no emite certificados. El umbral de oportunidad es **50 puntos**.

| Señal existente | Puntos | Fuente |
| --- | ---: | --- |
| Captura del contacto | 10 | Registro del contacto |
| WhatsApp disponible | 15 | Teléfono normalizado |
| Primer curso completado | 40 | Evento `course_completed` |
| Cada curso adicional completado | 10 | Eventos `course_completed` adicionales |
| Certificado informado por la integración | 10 | Evento histórico `certificate_issued`; Finance sigue siendo la autoridad |
| Contacto creado en los últimos siete días | 5 | `createdAt` |

Solo las etapas `NUEVO`, `INSCRITO`, `EN_CURSO` y `CERTIFICADO` pueden promoverse automáticamente a `OPORTUNIDAD`. `CLIENTE` y `PERDIDO` requieren decisión humana, confirmación e historial. El recálculo global exige confirmación y deja auditoría.
