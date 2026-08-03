# Auditoria del catalogo oficial de cursos

Fecha de verificacion: 2026-08-03. Fuente primaria: `https://ra-training.com/courses-1/`, paginas individuales y API REST publica de WordPress.

El catalogo visible contiene 11 cursos. Existen 9 paginas individuales verificadas y 2 tarjetas sin pagina individual. El mapeo completo, diferencias de contenido y estado de cada CTA estan documentados en `COURSE_CAPTURE_CAMPAIGN.md` y centralizados en `src/data/course-capture-mapping.ts`.

Los registros CRM historicos que no aparecen en el catalogo se conservan. No se borran relaciones ni se conectan a cursos actuales por similitud. `acceptsRegistrations` permite cerrar formularios historicos sin alterar su informacion.

La importacion controlada de catalogo sigue siendo idempotente, exige rol ADMIN y confirmacion, se bloquea en Produccion y desactiva sobrantes sin borrarlos. Los cambios de esta campana agregan dos cursos exactos que faltaban y no reutilizan los registros antiguos de nombre parecido.
