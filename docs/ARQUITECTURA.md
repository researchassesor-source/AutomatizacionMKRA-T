# Arquitectura — Motor de Automatización RA-Training

## El embudo completo

```
                 ┌─────────────────────────────────────────────┐
                 │  1. ATRAER  (redes sociales)                │
                 │  Orquestador publica en IG/FB/TikTok/YT/IN  │
                 └───────────────────┬─────────────────────────┘
                                     │  clic
                                     ▼
                 ┌─────────────────────────────────────────────┐
                 │  2. CAPTAR  (landing del curso gratuito)    │
                 │  /cursos/[slug] → formulario → /api/leads   │
                 └───────────────────┬─────────────────────────┘
                                     │  lead en el CRM
                                     ▼
                 ┌─────────────────────────────────────────────┐
                 │  3. NUTRIR  (email / WhatsApp)   [Fase 2]   │
                 │  Secuencia de bienvenida + acceso al curso  │
                 └───────────────────┬─────────────────────────┘
                                     │  completa el curso
                                     ▼
                 ┌─────────────────────────────────────────────┐
                 │  4. CERTIFICAR  (folio + verificación) [F3] │
                 └───────────────────┬─────────────────────────┘
                                     │  lead "caliente"
                                     ▼
                 ┌─────────────────────────────────────────────┐
                 │  5. VENDER  (scoring → catálogo de pago) [F4]│
                 └─────────────────────────────────────────────┘
```

## Principio de diseño: adaptadores

Cada red social implementa la interfaz `SocialAdapter` (`src/lib/social/types.ts`).
El orquestador no conoce los detalles de cada API: sólo pide `publish()`.

Añadir una red nueva = crear su adaptador y registrarlo en
`src/lib/social/orchestrator.ts`. El resto del sistema no cambia.

```
Orquestador ──► SocialAdapter (interfaz)
                   ├── MetaAdapter        (Instagram + Facebook)  ✅
                   ├── TikTokAdapter      🔜
                   ├── YouTubeAdapter     🔜
                   └── LinkedInAdapter    🔜
```

## Modelo de datos (CRM)

- **Course** — catálogo de cursos (gratuitos y, luego, de pago).
- **Lead** — contacto; núcleo del CRM. Tiene una `stage` (etapa del embudo).
- **LeadEvent** — bitácora de interacciones; base del *scoring* de la Fase 4.
- **SocialAccount** — cuentas de redes conectadas (tokens).
- **SocialPost** — publicaciones con estado y programación (la "cola").

### Etapas del lead (`LeadStage`)

`NUEVO → INSCRITO → EN_CURSO → CERTIFICADO → OPORTUNIDAD → CLIENTE`
(o `PERDIDO`). Estas etapas son las que, en la Fase 4, disparan las
automatizaciones de venta.

## Por qué híbrido y no "todo propio"

| Pieza | Decisión | Motivo |
|-------|----------|--------|
| CRM / base de contactos | **Propio** (este repo) | Es la lógica de negocio; nos da control total del embudo |
| Publicación en redes | **Propio** (orquestador) | Apalancamiento: publicar una vez → muchas redes |
| Email / WhatsApp masivo | **Integrar por API** | La entregabilidad y el anti-spam son un mundo aparte |
| LMS (hospedar el curso) | **Integrar** al inicio | Reinventarlo no da ventaja; se puede internalizar después |

## Decisiones pendientes (para conversar)

- Proveedor de email transaccional (Resend / Postmark / SES).
- Hospedaje del contenido del curso (LMS propio vs. integrado).
- Dónde correr el cron del orquestador (Vercel Cron, GitHub Actions, servidor).
- Cifrado de tokens de `SocialAccount` (secret manager en producción).
