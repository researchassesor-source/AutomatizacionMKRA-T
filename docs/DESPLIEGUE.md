# Guía de despliegue — Motor MKRA-T

Cómo poner el sistema en producción, paso a paso. Está pensada para seguirse
en orden. Al final tienes un checklist.

**Arquitectura del despliegue:**

```
   Vercel (app Next.js)  ───►  PostgreSQL gestionado (Neon / Supabase)
        │  │  │
        │  │  └── Cron ─► /api/nurture/dispatch  y  /api/social/publish
        │  └───────────► Meta Graph API (Instagram / Facebook)
        │  └───────────► Proveedor de email (Resend)
        └──────────────► ra-training-finance (certificados + aval)
```

---

## Paso 0 · Cuentas que necesitas

- [ ] **Vercel** (vercel.com) — para hospedar la app. Plan Hobby sirve para empezar.
- [ ] **Base de datos PostgreSQL gestionada** — recomiendo **Neon** (neon.tech) o **Supabase** (supabase.com). Ambas tienen plan gratis.
- [ ] **Meta for Developers** (developers.facebook.com) — para Instagram/Facebook.
- [ ] **Proveedor de email** — recomiendo **Resend** (resend.com).
- [ ] Acceso a **ra-training-finance** para crear un usuario de servicio.

---

## Paso 1 · Base de datos PostgreSQL

1. Crea un proyecto en Neon (o Supabase).
2. Copia la **cadena de conexión** (`postgresql://usuario:clave@host/db?sslmode=require`).
3. La guardarás como `DATABASE_URL` en Vercel (Paso 5).

Las tablas se crean solas en el primer despliegue con `prisma db push` (ver Paso 6).

---

## Paso 2 · Credenciales de Meta (Instagram + Facebook)

> Requisito: una **Página de Facebook** y una cuenta de **Instagram Business o
> Creator** vinculada a esa página.

1. En developers.facebook.com crea una **App** (tipo "Business").
2. Agrega los productos **Facebook Login** e **Instagram Graph API**.
3. En **Herramientas → Graph API Explorer** genera un **token de acceso** con
   permisos: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
   `instagram_basic`, `instagram_content_publish`.
4. Convierte el token en uno de **larga duración** (documentación de Meta) para
   que no expire cada hora.
5. Anota:
   - `META_ACCESS_TOKEN` — el token de larga duración.
   - `META_PAGE_ID` — ID de tu Página de Facebook.
   - `META_IG_USER_ID` — ID de la cuenta de Instagram Business.

> Puedes probar estas credenciales luego desde el panel: **Admin → Redes →
> Probar conexión**.

---

## Paso 3 · Proveedor de email (Resend)

1. Crea una cuenta en resend.com.
2. **Verifica tu dominio** `ra-training.com` (agrega los registros DNS que te
   indican). Esto es clave para que los correos no caigan en spam.
3. Crea una **API Key**.
4. Anota:
   - `EMAIL_API_KEY` — la API key.
   - `EMAIL_FROM` — ej. `hola@ra-training.com` (del dominio verificado).

---

## Paso 4 · Usuario de servicio en ra-training-finance

MKRA-T necesita una cuenta en finance para crear las inscripciones (handoff).

1. En finance, crea un **usuario** con rol **`vendedor`** (ej. `mkra-bot`).
2. Anota su usuario y contraseña.
3. Ten a mano:
   - `FINANCE_API_URL` — la URL que acepta `?payload=` (el `/api/proxy` de
     finance en Vercel, o la URL `…/exec` del Apps Script).
   - `FINANCE_APP_URL` — la URL pública del sitio de finance (para los enlaces
     de verificación), ej. `https://finanzas.ra-training.com`.
   - `FINANCE_USER` / `FINANCE_PASS` — las credenciales del usuario de servicio.
   - `FINANCE_SERVICE_NAME` — el servicio a inscribir (ej. `Certificado LMS`).
   - `FINANCE_AUTO_EMIT` — `false` (manual) o `true` (emite el certificado al
     completar el curso). Recomendado `false` salvo cursos gratuitos sin aval.

---

## Paso 5 · Desplegar en Vercel

1. En Vercel: **Add New → Project** e importa el repositorio
   `researchassesor-source/AutomatizacionMKRA-T`.
2. Framework: **Next.js** (se detecta solo).
3. En **Settings → Environment Variables**, agrega todas (ver tabla abajo).
4. **Deploy**.

### Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | cadena de conexión de Postgres (Paso 1) |
| `APP_URL` | la URL pública de la app (ej. `https://mkra.ra-training.com`) |
| `ADMIN_PASSWORD` | contraseña del panel `/admin` |
| `CRON_SECRET` | una cadena aleatoria larga (protege los cron) |
| `META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID` | Paso 2 |
| `EMAIL_API_KEY`, `EMAIL_FROM` | Paso 3 |
| `FINANCE_API_URL`, `FINANCE_APP_URL` | Paso 4 |
| `FINANCE_USER`, `FINANCE_PASS`, `FINANCE_SERVICE_NAME` | Paso 4 |
| `FINANCE_AUTO_EMIT` | `false` o `true` (Paso 4) |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | opcional (WhatsApp) |

> Sin credenciales de Meta/email, esas partes quedan inactivas o en modo *log*,
> pero la app funciona. Sin `FINANCE_*`, el handoff responde 503.

---

## Paso 6 · Crear las tablas (primer despliegue)

La forma más simple: desde tu máquina, apuntando a la base de producción, una
sola vez:

```bash
# con DATABASE_URL de produccion en tu .env local
npm run db:push     # crea las tablas
npm run db:seed     # carga los cursos de ejemplo (opcional)
```

> Alternativa: agregar `prisma db push` a un script de build. Para empezar, el
> comando manual es más seguro.

---

## Paso 7 · Cron jobs

Hay dos tareas periódicas que disparan la automatización:

- `/api/nurture/dispatch` — envía los correos/WhatsApp vencidos (cada ~10 min).
- `/api/social/publish` — publica los posts programados (cada ~15 min).

Ambas aceptan `GET` protegido con `CRON_SECRET` (cabecera
`Authorization: Bearer <CRON_SECRET>`).

### Opción A — Plan gratuito (Hobby): cron externo

El plan Hobby de Vercel **solo permite cron una vez al día**, insuficiente para
esto. Usa un cron externo gratuito, ej. **[cron-job.org](https://cron-job.org)**:

1. Crea dos "cronjobs", uno por URL:
   - `https://TU-APP/api/nurture/dispatch` cada 10 min.
   - `https://TU-APP/api/social/publish` cada 15 min.
2. En cada uno, agrega una **cabecera HTTP**:
   `Authorization: Bearer <tu CRON_SECRET>`.
3. Método **GET**. Guarda.

### Opción B — Plan Pro: cron nativo de Vercel

Con el plan Pro puedes usar el cron de Vercel. Agrega esto a `vercel.json` y
vuelve a desplegar:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/nurture/dispatch", "schedule": "*/10 * * * *" },
    { "path": "/api/social/publish", "schedule": "*/15 * * * *" }
  ]
}
```

Vercel envía solo la cabecera `Authorization: Bearer <CRON_SECRET>`.

---

## Paso 8 · Verificación post-despliegue

- [ ] Abre `https://TU-APP/` → se ve el catálogo de cursos.
- [ ] Abre una landing `/cursos/...` y envía el formulario → aparece en **Admin → Leads**.
- [ ] Entra a `/admin` con `ADMIN_PASSWORD`.
- [ ] **Admin → Redes → Probar conexión** (Instagram) → responde OK.
- [ ] Completa un curso en `/aula/...` → aparece en **Admin → Certificados** (handoff a finance).
- [ ] **Admin → Ventas → Recalcular** → los que completaron curso pasan a Oportunidad.
- [ ] Revisa que llega el correo de bienvenida (si configuraste email).

---

## ⚠️ Antes de anunciar públicamente

- **Aval del Ministerio de Trabajo**: el certificado dice "constancia de
  finalización" salvo que el curso tenga el aval activado en finance. No
  anuncies aval oficial hasta tenerlo gestionado legalmente.
- **Protección de datos**: el formulario pide consentimiento. Cumple la ley de
  datos personales de tu país (política de privacidad, tratamiento, etc.).
- **APIs oficiales**: usa siempre las APIs oficiales de las redes. Automatizar
  por vías no oficiales puede bloquear tus cuentas.
