# WhatsApp Cloud API · lo que hay que configurar en Meta

Este documento cubre **solo la parte externa**. El código del CRM ya está
completo: plantillas, webhook, estados y modo propio del canal.

Ningún valor secreto aparece aquí. Donde dice «pega el valor» se refiere a algo
que solo existe en el panel de Meta y en las variables de Vercel.

---

## 1. Webhook

**URL de devolución de llamada** (Callback URL):

```
https://automatizacion-mkra-t2.vercel.app/api/webhooks/whatsapp
```

**Verify token**: el valor que pongas en la variable `META_WEBHOOK_VERIFY_TOKEN`
de Vercel. Debe coincidir carácter a carácter con lo que escribas en Meta. Es un
valor que eliges tú; no lo genera Meta.

Al pulsar «Verificar y guardar», Meta hace un `GET` con `hub.mode=subscribe`.
La ruta responde el `hub.challenge` solo si el token coincide.

**Campo a suscribir**: `messages`, y solo ese. Trae tanto los estados de entrega
(`statuses[]`) como los mensajes entrantes (`messages[]`).

Opcionales, si más adelante interesan: `message_template_status_update` (avisa de
la aprobación o rechazo de una plantilla) y `phone_number_quality_update`.

### Guardar el callback NO es suscribir la app

Son dos pasos distintos y es el error más común:

1. **Guardar el callback** en *WhatsApp → Configuración → Webhook* registra la
   URL de la aplicación.
2. **Suscribir la app al WABA** conecta esa aplicación con tu cuenta de WhatsApp
   Business concreta. Sin esto la URL queda verificada pero no llega ni un solo
   evento.

El segundo paso se hace desde el propio panel (*WhatsApp → Configuración de la
API → Webhooks → Administrar*) o con una llamada:

```
POST https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps
```

Para comprobar que quedó hecho:

```
GET https://graph.facebook.com/v25.0/<WABA_ID>/subscribed_apps
```

Debe devolver la aplicación en la lista. Si devuelve una lista vacía, el webhook
no recibirá nada aunque la verificación haya salido bien.

---

## 2. Plantillas que hay que crear

Cinco plantillas, categoría **UTILITY** (no MARKETING: son transaccionales sobre
algo que la persona contrató; se aprueban antes y cuestan menos), idioma
**Español (`es`)**.

Los nombres deben escribirse **exactamente así**, en minúsculas:

| Nombre exacto | Parámetros, en este orden |
|---|---|
| `ra_training_bienvenida_inscripcion` | `{{1}}` nombre · `{{2}}` curso · `{{3}}` fecha · `{{4}}` hora |
| `ra_training_recordatorio_24h` | `{{1}}` nombre · `{{2}}` curso · `{{3}}` fecha · `{{4}}` hora |
| `ra_training_acceso_2h` | `{{1}}` nombre · `{{2}}` curso · `{{3}}` hora · `{{4}}` enlace |
| `ra_training_acceso_15min` | `{{1}}` nombre · `{{2}}` curso · `{{3}}` enlace |
| `ra_training_agradecimiento_final` | `{{1}}` nombre · `{{2}}` curso |

**El orden importa y no es negociable**: el CRM rellena las posiciones en ese
orden exacto. Si en Meta se intercambian dos variables, los mensajes saldrán con
los datos cruzados sin que nada falle visiblemente.

Texto sugerido para cada una (se puede ajustar la redacción, **no el número ni el
orden de las variables**):

- **Bienvenida**: `Hola {{1}}, tu inscripción a {{2}} quedó registrada. Fecha: {{3}}. Hora: {{4}}. Te avisaremos antes de cada sesión.`
- **24 horas**: `Hola {{1}}, mañana tienes una sesión de {{2}}. Fecha: {{3}}. Hora: {{4}}. El enlace de acceso te llegará 2 horas antes.`
- **2 horas**: `Hola {{1}}, tu sesión de {{2}} comienza a las {{3}}. Este es tu enlace de acceso: {{4}}`
- **15 minutos**: `Hola {{1}}, la sesión de {{2}} empieza en 15 minutos. Ingresa aquí: {{3}}`
- **Agradecimiento**: `¡Felicitaciones {{1}}! Completaste {{2}}. Gracias por acompañarnos.`

### Por qué el enlace va en el texto y no en un botón

Un botón de URL dinámica fija el prefijo en la plantilla y solo admite un sufijo
variable (`https://ejemplo.com/{{1}}`). Nuestros enlaces de sesión son de
dominios ajenos y arbitrarios (Meet, Zoom, Teams), así que ningún prefijo fijo
serviría. Un parámetro de cuerpo sí admite la URL completa.

El código **sí soporta botones de URL** y está probado, por si en el futuro se
crea una plantilla con un prefijo propio. Estas cinco no lo usan.

Al registrar las plantillas, Meta pide un ejemplo por variable. Cualquier valor
representativo sirve (un nombre, un curso, una fecha, una URL https).

---

## 3. Permisos

- `whatsapp_business_messaging` — enviar y recibir.
- `whatsapp_business_management` — gestionar plantillas y el WABA.

Ambos necesitan **Acceso avanzado** para hablar con números que no tengan un rol
en la aplicación. Mientras la app esté en Desarrollo, solo se puede escribir a
administradores, desarrolladores y probadores: suficiente para la prueba real.

---

## 4. Variables de Vercel

Nombres, sin valores. Marca en Vercel como *sensitive* todas menos `WHATSAPP_MODE`
y `WHATSAPP_LIVE_FROM`.

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Identifica el número emisor en el endpoint | Sí, para enviar |
| `WHATSAPP_ACCESS_TOKEN` | Autenticación de las llamadas a Graph | Sí, para enviar |
| `META_APP_SECRET` | Verificar la firma `X-Hub-Signature-256` | Sí, para el webhook |
| `META_WEBHOOK_VERIFY_TOKEN` | Handshake de alta del webhook | Sí, para el webhook |
| `WHATSAPP_MODE` | `disabled` \| `simulation` \| `live` | Sí |
| `WHATSAPP_LIVE_FROM` | Fecha ISO 8601 en UTC desde la que puede salir | Sí, si `live` |
| `WHATSAPP_GRAPH_API_VERSION` | Versión de Graph solo para WhatsApp | No (por defecto v25.0) |

**`WHATSAPP_MODE` es independiente de `MESSAGING_MODE`.** Cambiarlo no toca el
correo, y el correo real seguirá funcionando pase lo que pase con WhatsApp. Si la
variable no existe, el canal queda deshabilitado: no envía ni simula.

**`WHATSAPP_ACCESS_TOKEN` no es `META_SYSTEM_USER_TOKEN`.** Son tokens distintos y
el código nunca los mezcla: el segundo lo usa solo el módulo de Facebook e
Instagram.

Sobre la caducidad: el token temporal del panel de WhatsApp dura **24 horas**. El
de usuario del sistema es permanente. Conviene confirmar cuál está puesto antes
de la prueba, porque con el temporal todo lo demás da igual al día siguiente.

> Nota sobre `/debug_token`: permitiría comprobar caducidad y permisos, pero
> exige enviar un token de aplicación (`APP_ID|APP_SECRET`) en la petición. No se
> ha implementado esa comprobación para no añadir una ruta administrativa que
> maneje el App Secret sin necesidad. Se puede consultar puntualmente desde el
> Explorador de tokens de acceso de Meta.

---

## 5. Orden de activación

1. Confirmar que el token es de usuario del sistema (permanente).
2. Configurar el método de pago. **Sin esto no sale ninguna plantilla.**
3. Crear las cinco plantillas y esperar su aprobación (24–48 h).
4. Poner las variables en Vercel con `WHATSAPP_MODE=simulation`.
5. Dar de alta el webhook y **suscribir la app al WABA** (los dos pasos).
6. Aplicar el plan de WhatsApp a un curso de prueba desde el panel.
7. Añadir el número de prueba como *probador* de la app.
8. Pasar `WHATSAPP_MODE=live` con `WHATSAPP_LIVE_FROM` = ahora.
9. Hacer la prueba real de extremo a extremo.
10. Solicitar Acceso avanzado y publicar la app.

---

## 6. Qué observar en la prueba real

| Paso | Dónde | Qué debe verse |
|---|---|---|
| Inscripción de prueba | `/admin/leads` | Contacto `REAL` con consentimiento |
| Programación | `/admin/mensajes` | Fila WhatsApp en **PROGRAMADO** |
| Envío (≤5 min) | `/admin/mensajes` | **ACEPTADO** con `ID proveedor: wamid.…` |
| Recepción | El teléfono | Llega el mensaje con los datos en su sitio |
| Webhook | `/admin/mensajes` | **ENVIADO** → **ENTREGADO** |
| Lectura | Abrir el mensaje | **LEÍDO** |
| Trazabilidad | Auditoría | `MESSAGE_PROVIDER_STATUS_UPDATED` por transición |

Diagnóstico rápido si algo se detiene:

- **Se queda en PROGRAMADO** → `WHATSAPP_MODE` no es `live`, o la fecha de
  programación es anterior a `WHATSAPP_LIVE_FROM`, o el cron no está corriendo.
- **Se queda en ACEPTADO** → el mensaje salió, pero el webhook no llega: revisa
  la suscripción al WABA (paso 5), no solo la verificación de la URL.
- **Aparece OMITIDO con `WHATSAPP_TEMPLATE_MISSING`** → la regla no tiene
  plantilla asignada. Aplica el plan de WhatsApp al curso.
- **FALLIDO con `WHATSAPP_132001`** → el nombre o el idioma de la plantilla no
  coinciden con lo aprobado en Meta.
- **FALLIDO con `WHATSAPP_131047`** → se intentó texto libre fuera de ventana.
  No debería ocurrir: el código lo impide en dos puntos.

El estado completo del canal está en `/admin/mensajes`, panel «Estado de
WhatsApp»: modo, credenciales, webhook y plantillas, sin mostrar ningún valor.
