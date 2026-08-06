# Operación de correo automático y publicación orgánica

Guía operativa del cierre del 6 de agosto de 2026. Cubre el envío real de
correos y la publicación orgánica en Facebook e Instagram.

## 1. Qué quedó operativo

| Función | Estado |
| --- | --- |
| Envío real por SMTP institucional | Implementado |
| Correo de bienvenida al inscribirse | Implementado |
| Recordatorios 24 h, 2 h y 15 min **por sesión** | Implementado |
| Agradecimiento tras la última sesión | Implementado |
| Idempotencia (el cron repetido no duplica) | Implementado |
| Publicación orgánica programada en Facebook | Implementado |
| Publicación orgánica programada en Instagram | Implementado |
| WhatsApp | Pendiente de conexión, no bloquea |
| Campañas pagadas de Meta | Pendiente de cuenta publicitaria |
| TikTok dentro del CRM | Configuración externa lista, integración pendiente |

## 2. Variables de entorno

### Correo (obligatorias para el envío real)

```
EMAIL_PROVIDER=smtp
EMAIL_FROM=avillagomez@ra-training.com
EMAIL_FROM_NAME=R.A. Training
EMAIL_REPLY_TO=avillagomez@ra-training.com
SMTP_HOST=mail.ra-training.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=avillagomez@ra-training.com
SMTP_PASSWORD=<Sensitive>
MESSAGING_MODE=live
MESSAGING_LIVE_FROM=<ISO 8601 UTC, por ejemplo 2026-08-06T18:00:00Z>
```

`SMTP_PASSWORD` debe marcarse **Sensitive** en Vercel. Nunca se escribe en el
repositorio, en logs ni en respuestas al navegador.

`MESSAGING_MODE=live` es imprescindible: sin él el CRM registra los mensajes
como `SIMULADO` y no contacta a nadie. Fuera de Producción la simulación se
fuerza siempre, aunque la variable diga `live`.

`EMAIL_API_KEY` (Resend) se conserva solo como respaldo histórico. Si existe
`SMTP_HOST`, SMTP tiene prioridad. No hay dos configuraciones paralelas.

### Meta (obligatorias para publicar)

```
META_APP_ID=2050435515544217
META_BUSINESS_ID=1601686108146096
META_PAGE_ID=1190035477534301
META_INSTAGRAM_ACCOUNT_ID=17841403176483044
META_GRAPH_API_VERSION=v25.0
META_SYSTEM_USER_TOKEN=<Sensitive>
SOCIAL_MODE=live
SOCIAL_LIVE_FROM=<ISO 8601 UTC, por ejemplo 2026-08-06T18:00:00Z>
```

Los nombres anteriores `META_ACCESS_TOKEN` y `META_IG_USER_ID` siguen
funcionando; si están ambos, mandan los nombres nuevos.

`META_APP_SECRET` y `META_WEBHOOK_VERIFY_TOKEN` solo son necesarios si más
adelante se implementan webhooks. No bloquean la publicación orgánica.

### Procesos programados

```
CRON_SECRET=<Sensitive>
```

Mismo valor en Vercel y en el secreto del repositorio de GitHub.

## 3. Cómo se calculan los recordatorios

1. Cada curso puede tener varias **sesiones** (`/admin/cursos` → “Configurar
   sesiones”). Cada sesión tiene fecha de inicio, cierre opcional y enlace de
   transmisión propio opcional.
2. Si una sesión no tiene enlace propio, hereda el **enlace del curso**. El
   mismo enlace puede repetirse en todas las sesiones.
3. Un curso **sin sesiones registradas** sigue funcionando: su fecha general se
   trata como una sesión única. Los cursos que ya existían no cambian de
   comportamiento ni reciben mensajes nuevos.
4. Los recordatorios “antes de cada sesión” generan **un mensaje por sesión
   futura**. Las sesiones pasadas nunca se programan.
5. El agradecimiento se calcula sobre el cierre de la **última** sesión.
6. Toda hora se guarda en UTC y se muestra en `America/Guayaquil`.

### Enlace de transmisión ausente

El recordatorio de 15 minutos está marcado como “requiere enlace de
transmisión”. Si la sesión no tiene enlace, el mensaje **no se envía vacío**:
se registra como `OMITIDO` con el motivo
«La sesión no tiene un enlace de transmisión configurado» y aparece en
`/admin/mensajes`. En cuanto se configura el enlace, el mensaje vuelve a
`PROGRAMADO` automáticamente.

## 4. Puesta en marcha (orden exacto)

1. **Migración**. Producción no aplica migraciones en el build:

   ```bash
   npx prisma migrate deploy
   ```

   con `POSTGRES_URL_NON_POOLING` apuntando a la base de Producción.

2. **Variables** de la sección 2 en Vercel (Production), `SMTP_PASSWORD` y
   `META_SYSTEM_USER_TOKEN` como Sensitive.

3. **Redeploy** del proyecto.

4. **Comprobar el correo**: `/admin/mensajes` → “Comprobar credenciales”.
   Después “Enviar correo de prueba” a una dirección propia.

5. **Registrar cuentas de Meta**: `/admin/redes` → “Sincronizar cuentas de
   Meta”. Debe mostrar la página y la cuenta de Instagram como
   «Conexión validada».

6. **Aplicar el plan de correos** al curso activo:
   `/admin/automatizaciones` → “Aplicar plan estándar”. Déjalo en borrador,
   revisa los textos y actívalo cuando estés conforme.

7. **Configurar sesiones y enlace**: `/admin/cursos` → “Configurar sesiones”.

8. **Prueba de punta a punta**: inscribirse con un correo propio desde el enlace
   público del curso y confirmar que llega la bienvenida.

## 5. Ejecución manual de los procesos

Desde el panel:

- `/admin/mensajes` → “Procesar cola” envía lo vencido.
- `/admin/redes` → “Procesar” publica una entrada concreta.

Desde la línea de comandos (sustituye `TU_SECRETO` por el valor real; no lo
escribas en ningún archivo del repositorio):

```bash
curl -X POST "https://automatizacion-mkra-t2.vercel.app/api/nurture/dispatch" -H "Authorization: Bearer TU_SECRETO"
```

```bash
curl -X POST "https://automatizacion-mkra-t2.vercel.app/api/social/publish" -H "Authorization: Bearer TU_SECRETO"
```

## 6. Reintentos

- **Mensaje fallido**: `/admin/mensajes` → “Reintentar”. El motor reintenta solo
  hasta 5 veces con espera creciente (5, 10, 20, 40 minutos, máximo 4 horas).
  Un mensaje ya aceptado por el proveedor nunca se reenvía.
- **Publicación fallida**: `/admin/redes` → “Reintentar”. Una publicación que ya
  tiene identificador del proveedor no vuelve a enviarse: es la garantía de que
  el cron repetido no duplica contenido.

## 7. Qué no hace el sistema

- No afirma que un participante esté certificado. Terminar un curso no cambia el
  estado de certificado.
- No envía WhatsApp. Los mensajes de ese canal quedan pendientes y nunca se
  marcan como enviados.
- No crea campañas pagadas de Meta.
- No publica los **borradores** existentes al desplegar.

## 8. Fecha de activación: protección contra la cola atrasada

Los procesadores seleccionan lo vencido (`scheduledAt <= ahora`), no solo lo
futuro. Sin protección, pasar un canal a `live` vaciaría de golpe toda la cola
atrasada sobre los contactos o sobre las redes.

Por eso activar un canal exige **dos** variables, no una:

| Canal | Modo | Fecha de corte |
| --- | --- | --- |
| Correo | `MESSAGING_MODE=live` | `MESSAGING_LIVE_FROM` |
| Redes | `SOCIAL_MODE=live` | `SOCIAL_LIVE_FROM` |

Formato obligatorio: ISO 8601 en UTC con `Z` final, por ejemplo
`2026-08-06T18:00:00Z`. Se rechaza una fecha sin zona horaria explícita porque
se interpretaría distinto según el servidor.

Reglas que aplica el sistema:

- **Modo `live` sin fecha válida ⇒ canal bloqueado.** El procesador no consulta
  la cola, no envía y no publica; deja constancia en la auditoría y el panel de
  integraciones lo muestra como configuración incompleta. Falla de forma segura.
- Solo sale lo que cumple `scheduledAt >= fecha de corte`.
- Lo anterior al corte **permanece visible** en Mensajes y en Redes, con su
  estado intacto, para revisarlo, cancelarlo o reprogramarlo. Nunca sale solo.
- Las recurrencias semanales anteriores al corte **se adelantan** hasta su
  primera ocurrencia válida sin materializar las publicaciones atrasadas.
- En `simulation` no hacen falta estas fechas: el sistema funciona igual y no
  contacta a nadie.

Las dos fechas son independientes: se puede activar el correo y dejar las redes
en simulación, o al revés.

### Secuencia recomendada

1. Desplegar con ambos modos en `simulation`. Nada sale.
2. Revisar qué hay en cola:

   ```bash
   npm run report:preflight
   ```

3. Cancelar desde el panel lo que no deba salir.
4. Definir `MESSAGING_LIVE_FROM` / `SOCIAL_LIVE_FROM` con el momento a partir
   del cual sí se quiere operar de verdad.
5. Recién entonces poner el modo en `live`.

El paso 3 sigue siendo buena práctica, pero ya no es la única defensa: aunque se
omita, la fecha de corte impide que la cola atrasada salga sola.
