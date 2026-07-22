# MKRA-T · Motor de Automatización de RA-Training

Automatización de marketing y ventas para **[ra-training.com](https://ra-training.com)**: una empresa de capacitación que ofrece **cursos gratuitos de enganche** para hacer crecer su base de contactos y, desde ahí, vender su catálogo de cursos.

> **Enfoque híbrido:** este proyecto es el **motor orquestador** propio que integra herramientas existentes por API (redes sociales, email, WhatsApp). No reinventamos un CRM completo desde cero; construimos la lógica de negocio que nos da ventaja y conectamos lo demás.

---

## ¿Qué hace hoy?

**Fase 1 — Captación de leads**
- **Landing pages de cursos gratuitos** con formulario de inscripción (`/cursos/[slug]`).
- **Captura de leads** en el CRM propio (deduplicación por email, tracking de UTM).
- **Base del CRM**: contactos, etapas del embudo, bitácora de eventos.
- **Orquestador de publicación en redes**: cola de publicaciones + adaptadores por red social (Meta/Instagram/Facebook listo; TikTok, YouTube y LinkedIn preparados para añadir) + verificación de conexión.

**Fase 2 — Nurture (email / WhatsApp)**
- **Secuencia de bienvenida** que se encola automáticamente al inscribirse un lead (idempotente): email de acceso inmediato, recordatorio a las 24 h y oferta del catálogo a las 72 h.
- **Canales con adaptadores**: email (Resend como ejemplo) y WhatsApp Cloud API. Sin credenciales funcionan en **modo log** para probar toda la secuencia.
- **Dispatcher** que envía los mensajes vencidos (pensado para un cron).

**Panel de administración** (`/admin`, protegido con contraseña)
- Resumen con métricas, lista de **leads**, cola de **nurture** y gestión de **redes** (probar conexión, registrar cuentas, crear/programar/publicar posts).

## Roadmap

| Fase | Módulo | Estado |
|------|--------|--------|
| 1 | Captación: landing + captura de leads + publicación en redes | ✅ |
| 2 | Nurture: secuencias de email/WhatsApp de bienvenida | ✅ |
| — | Panel de administración | ✅ |
| 3 | Curso + certificado con folio único y verificación pública | 🔜 Modelo previsto |
| 4 | Ventas: scoring de leads y pipeline hacia catálogo de pago | 🔜 Modelo previsto |

---

## Stack

- **Next.js 15** (App Router) + **TypeScript** — landing pages y backend/API en un solo proyecto.
- **PostgreSQL** + **Prisma** — base de datos del CRM.
- **Zod** — validación de entradas.
- APIs oficiales de las plataformas (Meta Graph API, WhatsApp Cloud API, etc.).

## Arquitectura

Ver [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) para el diagrama del embudo y las decisiones de diseño.

```
src/
├── middleware.ts                # Protege /admin y /api/admin
├── app/
│   ├── page.tsx                 # Home con listado de cursos
│   ├── cursos/[slug]/           # Landing de curso + formulario (LeadForm)
│   ├── gracias/                 # Página de confirmación
│   ├── admin/                   # Panel: resumen, leads, mensajes, redes, login
│   └── api/
│       ├── leads/               # POST captura de leads (dispara nurture)
│       ├── nurture/dispatch/    # POST cron: envía mensajes vencidos
│       ├── social/publish/      # POST cron: publica posts programados
│       └── admin/               # API del panel (login, social, nurture)
├── lib/
│   ├── db.ts                    # Cliente Prisma
│   ├── admin-auth.ts            # Autenticación del panel
│   ├── leads.ts                 # Lógica de captura de leads
│   ├── nurture/                 # Motor de secuencias + canales (email/WhatsApp)
│   └── social/                  # Orquestador + adaptadores por red social
└── data/courses.ts              # Catálogo semilla de cursos
```

### Panel de administración

Define `ADMIN_PASSWORD` en `.env` para habilitarlo (sin ella queda deshabilitado)
y entra en `http://localhost:3000/admin`.

### Nurture (cron)

Igual que la publicación en redes, programa una llamada periódica:

```bash
curl -X POST https://TU-DOMINIO/api/nurture/dispatch
```

---

## Puesta en marcha (local)

Requisitos: Node 20+, Docker (para Postgres).

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env

# 3. Base de datos
docker compose up -d db
npm run db:push        # crea las tablas
npm run db:seed        # carga los cursos de ejemplo

# 4. Arrancar
npm run dev            # http://localhost:3000
```

## Publicación en redes (cron)

El orquestador publica los posts programados cuya hora ya llegó. Programa una
llamada periódica (cada 5–15 min) al endpoint:

```bash
curl -X POST https://TU-DOMINIO/api/social/publish
```

Publicar un post concreto de inmediato:

```bash
curl -X POST https://TU-DOMINIO/api/social/publish \
  -H "Content-Type: application/json" \
  -d '{"postId":"<id>"}'
```

> En producción protege este endpoint con un token de autorización.

---

## ⚠️ Notas importantes de negocio

- **Certificado avalado por el Ministerio de Trabajo:** el software genera y
  verifica certificados, pero el **aval oficial debe estar gestionado
  legalmente** antes de anunciarlo. Por eso el campo `hasCertificate` viene en
  `false` por defecto en los cursos de ejemplo.
- **Automatización de redes:** usa siempre las **APIs oficiales**. Automatizar
  por vías no oficiales (sobre todo Instagram/WhatsApp) puede provocar el bloqueo
  de las cuentas.
- **Datos personales:** el formulario exige consentimiento explícito. Cumple la
  ley de protección de datos aplicable a tu país.
