# Integracion de cursos

El catalogo general usa `NEXT_PUBLIC_COURSE_CATALOG_URL`, con fallback a `https://ra-training.com/courses-1/`. La relacion entre pagina oficial y formulario CRM se define exclusivamente en `src/data/course-capture-mapping.ts`; no se infieren slugs por similitud.

Cada curso puede registrar una URL oficial HTTPS de `ra-training.com`. Los formularios publicos solo se exponen cuando el registro existe, esta publicado y tiene `acceptsRegistrations=true`.

El formulario exige nombre, apellidos, correo, WhatsApp ecuatoriano normalizado y consentimiento. Captura cinco UTMs, fuente, landing y referrer. Incluye validacion cliente/servidor, honeypot, tiempo minimo, limite de payload, rate limiting, idempotencia, deduplicacion transaccional, CORS explicito y auditoria.

`GET /course-cta.js` conecta las nueve paginas individuales mapeadas conservando el componente visual del CTA y su tracking. Los dos cursos sin pagina individual permanecen enlazados al catalogo solo como referencia; no se inventan URLs.

Consulta `COURSE_CAPTURE_CAMPAIGN.md` antes de cualquier cambio en WordPress, Preview o Produccion.
