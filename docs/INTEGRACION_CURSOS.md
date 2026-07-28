# Integración de cursos

El catálogo general se centraliza en `NEXT_PUBLIC_COURSE_CATALOG_URL`, con fallback a `https://ra-training.com/courses-1/`.

Cada curso admite una URL oficial específica. El panel solo acepta destinos HTTPS de `ra-training.com`; la URL de Moodle solo acepta `moodle.ra-training.com`. El navegador nunca envía la URL de redirección: el servidor la obtiene del curso guardado después de crear o reutilizar la inscripción.

El formulario registra nombres, apellidos, correo, WhatsApp ecuatoriano normalizado, curso, consentimiento, UTM, origen y referrer. Incluye honeypot, tiempo mínimo, rate limiting e idempotencia.

Los cursos sin página individual confirmada usan el catálogo general. No se inventan rutas.
