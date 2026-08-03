# Captacion de cursos - campana agosto 2026

Fecha de verificacion: 2026-08-03.

Fuentes revisadas: catalogo publico, paginas individuales y API REST publica de WordPress de `ra-training.com`; codigo y esquema del CRM; configuracion versionada de Vercel. No se modifico Produccion durante esta preparacion.

## Mapeo explicito

| Curso visible | Slug oficial | Slug CRM | Pagina oficial | Formulario CRM | Estado CTA |
| --- | --- | --- | --- | --- | --- |
| IA para Apoyo en Tareas Academicas | `ia-para-apoyo-en-tareas-escolares` | `ia-apoyo-tareas-estudiantiles` | `https://ra-training.com/cursos/ia-para-apoyo-en-tareas-escolares/` | `/cursos/ia-apoyo-tareas-estudiantiles` | Pagina y CTA existentes; destino pendiente de publicar |
| IA para la Planificacion Educativa | `ia-para-la-planificacion-educativa` | `ia-planificacion-educativa` | `https://ra-training.com/cursos/ia-para-la-planificacion-educativa/` | `/cursos/ia-planificacion-educativa` | Pagina y CTA existentes; destino pendiente de publicar |
| IA para la Planificacion de Recursos Educativos | `ia-para-la-planificacion-de-recursos-educativos` | `ia-planificacion-recursos-educativos` | `https://ra-training.com/cursos/ia-para-la-planificacion-de-recursos-educativos/` | `/cursos/ia-planificacion-recursos-educativos` | Pagina y CTA existentes; destino pendiente de publicar |
| Comunicacion Estrategica Digital | `comunicacion-estrategica-digital` | `comunicacion-estrategica-digital` | `https://ra-training.com/cursos/comunicacion-estrategica-digital/` | `/cursos/comunicacion-estrategica-digital` | Curso CRM nuevo exacto; destino pendiente de publicar |
| Procedimientos Parlamentarios | `procedimientos-parlamentarios` | `procedimientos-parlamentarios` | `https://ra-training.com/cursos/procedimientos-parlamentarios/` | `/cursos/procedimientos-parlamentarios` | Pagina y CTA existentes; destino pendiente de publicar |
| Mecanismos de Participacion Ciudadana y Control Social | `mecanismos-de-participacion-ciudadana-y-control-social` | `mecanismos-de-participacion-ciudadana-y-control-social` | `https://ra-training.com/cursos/mecanismos-de-participacion-ciudadana-y-control-social/` | `/cursos/mecanismos-de-participacion-ciudadana-y-control-social` | Curso CRM nuevo exacto; destino pendiente de publicar |
| Habilidades Blandas para Profesionales | `habilidades-blandas-para-profesionales` | `habilidades-blandas-profesionales` | `https://ra-training.com/cursos/habilidades-blandas-para-profesionales/` | `/cursos/habilidades-blandas-profesionales` | Pagina y CTA existentes; destino pendiente de publicar |
| Redaccion y Elaboracion de Oficios | `redaccion-y-elaboracion-de-oficios` | `redaccion-elaboracion-oficios` | `https://ra-training.com/cursos/redaccion-y-elaboracion-de-oficios/` | `/cursos/redaccion-elaboracion-oficios` | Pagina y CTA existentes; destino pendiente de publicar |
| IA Generativa con Claude (Nivel Basico) | `ia-generativa-con-claude-nivel-basico` | `ia-generativa-claude-basico` | `https://ra-training.com/cursos/ia-generativa-con-claude-nivel-basico/` | `/cursos/ia-generativa-claude-basico` | Pagina publicada pero tarjeta sin enlace; CTA de la pagina pendiente de publicar |
| IA aplicada al Desarrollo de Tesis | Sin pagina individual | `ia-desarrollo-tesis` | `https://ra-training.com/courses-1/` | `/cursos/ia-desarrollo-tesis` | Tarjeta sin enlace ni CTA: no se inventa pagina |
| IA en Investigacion: Generacion de Contenido y Marketing | Sin pagina individual | `ia-investigacion-contenido-marketing` | `https://ra-training.com/courses-1/` | `/cursos/ia-investigacion-contenido-marketing` | Tarjeta sin enlace ni CTA: no se inventa pagina |

La fuente de verdad versionada es `src/data/course-capture-mapping.ts`. WordPress no debe inferir slugs por nombre.

## Hallazgos que requieren decision humana

- Los nueve CTA primarios de paginas individuales conservan actualmente el texto y estilo correctos, pero apuntan a WhatsApp.
- Dos tarjetas del catalogo no tienen pagina individual ni CTA. Deben permanecer reportadas hasta que R.A. Training publique sus paginas.
- El catalogo y la pagina individual de Redaccion difieren en la duracion (60 frente a 40 horas). Se conserva 40 horas, dato de la pagina individual, y se documenta la diferencia.
- La tarjeta de Claude publica USD 30; su pagina individual mezcla una introduccion gratis con un curso completo de USD 20. El CRM conserva el valor del catalogo y no presenta una promesa comercial nueva en el formulario.
- No se encontro una politica de privacidad oficial publicada en el sitio ni en el CRM. Esto es un bloqueo legal para Produccion. `NEXT_PUBLIC_PRIVACY_POLICY_URL` debe configurarse solo cuando exista una URL aprobada; no se inventa una ruta.

## Integracion mantenible del CTA

El CRM sirve `GET /course-cta.js`. El script:

- solo opera en las nueve rutas oficiales mapeadas;
- selecciona exclusivamente `a.boton-clase`;
- conserva texto, clases, estilos, animaciones, posicion, `target` y responsive;
- cambia solo `href` y agrega `data-crm-course` para trazabilidad;
- usa el mismo origen que sirve el script, por lo que un script de Preview abre formularios de Preview y el de Produccion abre Produccion;
- traslada `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `source`, `landing_url` y `referrer` con `URLSearchParams.set`, sin duplicados.

Para QA temporal, despues de validar el deployment Preview, WordPress puede cargar:

```html
<script defer src="https://URL-PREVIEW-APROBADA/course-cta.js"></script>
```

La URL productiva no debe instalarse hasta recibir autorizacion humana, publicar la politica de privacidad y completar el E2E. Antes de editar WordPress se debe guardar una copia del fragmento o configuracion previa. Si requiere autenticacion, el usuario inicia sesion directamente en el navegador; las credenciales no se solicitan por chat.

## Persistencia y seguridad

El formulario publico exige nombre, apellidos, correo, WhatsApp ecuatoriano y consentimiento. El servidor valida nuevamente, normaliza correo y telefono, comprueba que el curso exista, este publicado y acepte registros, y ejecuta contacto, inscripcion, atribucion y eventos en una transaccion serializable.

La identidad se protege con bloqueos transaccionales ordenados por correo y telefono. Una persona puede tener varias inscripciones; la combinacion contacto-curso sigue siendo unica. Reenviar el mismo curso actualiza atribucion sin degradar `Enrollment.status`. Se conservan honeypot, tiempo minimo, limite de carga, rate limit, idempotencia, Zod, CORS explicito, request ID y auditoria sin PII en logs tecnicos.

## QA y datos sinteticos

Los registros E2E deben usar dominio `example.test`, una clave de idempotencia unica, fuente `qa-cursos-agosto` y un telefono sintetico autorizado. El reporte debe guardar los IDs creados. Al finalizar, borrar o archivar solo esos IDs identificados, nunca realizar eliminaciones por patrones amplios sobre datos reales.

## Rollback

1. Retirar de WordPress el unico `<script>` de integracion y restaurar su configuracion previa guardada.
2. Revertir el commit de la rama feature; no reescribir historial.
3. No eliminar la migracion ya aplicada. `acceptsRegistrations=false` cierra formularios de forma reversible y conserva contactos e inscripciones.
4. Si un Preview falla, eliminar solamente la rama/base aislada de ese Preview mediante el procedimiento autorizado de Vercel/Neon.
5. Produccion requiere respaldo, revision SQL, ventana aprobada y autorizacion explicita antes de aplicar la migracion aditiva.
