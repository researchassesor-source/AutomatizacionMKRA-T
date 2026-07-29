# Auditoría del catálogo oficial de cursos

Fecha de verificación: 2026-07-29. Fuente primaria: [Catálogo oficial de R.A. Training](https://ra-training.com/courses-1/). No se consultó ni modificó Producción.

## Cursos observados en el CRM Preview

Según el estado confirmado al iniciar la auditoría, Preview conserva dos registros históricos/demostrativos que no aparecen en el catálogo oficial vigente:

| Curso CRM | Clasificación | Recomendación |
| --- | --- | --- |
| Excel Básico para el Trabajo | Sobrante histórico | Comprobar intereses, inscripciones, seguimientos, mensajes y auditoría; después desactivar, nunca borrar |
| Introducción a la Seguridad y Salud en el Trabajo | Sobrante histórico | Comprobar relaciones; después desactivar, nunca borrar |

La pantalla de comparación calcula esas relaciones antes de ofrecer una importación. Esta tarea no ejecutó la importación sobre Preview.

## Catálogo oficial normalizado

| Curso oficial | Categoría | Duración | Precio publicado | Estado | Enlace | Recomendación CRM |
| --- | --- | --- | --- | --- | --- | --- |
| IA para Apoyo en Tareas Académicas | IA para Educación | 60 horas | Gratis | Vigente | [Página individual](https://ra-training.com/cursos/ia-para-apoyo-en-tareas-escolares/) | Crear o actualizar; marcar gratuito y recurso de captación |
| IA para la Planificación de Recursos Educativos | IA para Educación | 60 horas | $20 | Vigente | [Página individual](https://ra-training.com/cursos/ia-para-la-planificacion-de-recursos-educativos/) | Crear o actualizar |
| IA para la Planificación Educativa | IA para Educación | 60 horas | $20 | Vigente | [Página individual](https://ra-training.com/cursos/ia-para-la-planificacion-educativa/) | Crear o actualizar |
| IA Generativa con Claude (Nivel Básico) | IA para Investigación | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar; conservar catálogo como URL hasta confirmar página individual |
| IA aplicada al Desarrollo de Tesis | IA para Investigación | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |
| IA en Investigación: Generación de Contenido y Marketing | IA para Investigación | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |
| Equipos que Ganan Elecciones | Gestión Pública y Ciudadanía | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |
| Procedimientos Parlamentarios para Organizaciones Sociales | Gestión Pública y Ciudadanía | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |
| Comunicación Estratégica Organizacional en Entornos Digitales | Gestión Pública y Ciudadanía | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |
| Redacción y Elaboración de Oficios | Redacción y Desarrollo Profesional | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |
| Habilidades Blandas para Profesionales | Redacción y Desarrollo Profesional | 60 horas | $30 | Vigente | [Catálogo](https://ra-training.com/courses-1/) | Crear o actualizar |

## Diferencias y criterio de fuente

- Los once cursos oficiales faltan en la base Preview descrita al inicio o deben compararse por `slug` antes de actualizarse.
- Los dos cursos históricos no deben eliminarse: el importador únicamente cambia `isPublished` a `false`.
- El catálogo principal publica “IA para Apoyo en Tareas Académicas” como gratuito, mientras la URL individual conserva un slug histórico con “tareas escolares”. El snapshot usa el nombre y precio del catálogo principal y conserva la URL individual existente. Esta discrepancia debe revisarse humanamente en el sitio oficial antes de Producción.
- Los cursos sin página individual comprobada apuntan al catálogo general; no se inventan rutas.

## Importación controlada

La vista `/admin/cursos` presenta un reporte de diferencias y relaciones. `GET /api/admin/courses/catalog` solo consulta. La aplicación requiere rol ADMIN, confirmación explícita y un entorno local o Preview. Se bloquea en Producción, usa `upsert` por `slug`, es idempotente, audita el resultado y desactiva sobrantes sin borrar registros ni relaciones.
