# Pruebas manuales de R.A. Training CRM

Estado inicial de todos los casos: `PENDIENTE`. Usar datos ficticios y mantener integraciones en simulación.

| Código | Módulo | Pasos | Resultado esperado | Estado | Evidencia sugerida |
|---|---|---|---|---|---|
| AUTH-01 | Login | Ingresar con usuario activo | Abre Resumen y registra auditoría | PENDIENTE | Captura del panel |
| AUTH-02 | Login | Probar credencial incorrecta | Mensaje genérico; no revela usuario | PENDIENTE | Captura del error |
| AUTH-03 | Logout | Pulsar Cerrar sesión y volver a una URL administrativa | Regresa al login y no abre el panel | PENDIENTE | Video corto |
| DASH-01 | Dashboard | Abrir Resumen | Tarjetas y accesos muestran cifras sin textos técnicos | PENDIENTE | Captura escritorio |
| COURSE-01 | Cursos | Crear curso con URL oficial válida | Curso guardado y auditado | PENDIENTE | Fila y auditoría |
| COURSE-02 | Cursos | Editar categoría, duración, precio y Moodle | Cambios persistentes | PENDIENTE | Antes/después |
| COURSE-03 | Cursos | Desactivar curso | Desaparece del catálogo público | PENDIENTE | Capturas |
| COURSE-04 | Cursos | Intentar URL fuera de ra-training.com | Se rechaza con mensaje claro | PENDIENTE | Captura del error |
| LEAD-01 | Formulario | Enviar sin WhatsApp | Se impide el registro | PENDIENTE | Captura del campo |
| LEAD-02 | Formulario | Ingresar 0982716252 | Se guarda como +593982716252 | PENDIENTE | Detalle del contacto |
| LEAD-03 | Formulario | Enviar correo inválido o sin consentimiento | Se rechaza | PENDIENTE | Captura |
| LEAD-04 | Formulario | Registrar el mismo correo dos veces al mismo curso | Se reutiliza contacto e inscripción | PENDIENTE | Detalle |
| LEAD-05 | Formulario | Registrar el mismo correo a otro curso | Aparecen dos inscripciones separadas | PENDIENTE | Tabla de cursos |
| LEAD-06 | Formulario | Usar UTM en la URL | Origen y campaña aparecen en detalle | PENDIENTE | Captura |
| LEAD-07 | Redirección | Completar formulario | Redirige solo a la URL guardada del curso | PENDIENTE | Video corto |
| LEAD-08 | Contactos | Buscar y aplicar filtros de etapa, curso, campaña, origen, responsable y fechas | Resultados correctos y paginados | PENDIENTE | Capturas |
| LEAD-09 | Contacto | Editar datos, responsable, etapa y próxima acción | Cambios persistentes y auditados | PENDIENTE | Captura |
| LEAD-10 | Archivo | Archivar y restaurar | Cambia entre vistas Activos/Archivados | PENDIENTE | Capturas |
| LEAD-11 | Eliminación | Como LECTURA intentar eliminar | Acción no disponible o 403 | PENDIENTE | Respuesta |
| LEAD-12 | Eliminación | Como ADMIN escribir nombre exacto | Elimina dato ficticio y audita | PENDIENTE | Auditoría |
| NOTE-01 | Notas | Agregar una nota | Aparece con autor y fecha | PENDIENTE | Captura |
| FOLLOW-01 | Seguimientos | Programar WhatsApp para hoy | Aparece en De hoy | PENDIENTE | Captura |
| FOLLOW-02 | Seguimientos | Completar y cancelar acciones | Estado y fecha se actualizan | PENDIENTE | Captura |
| FOLLOW-03 | Seguimientos | Abrir vista Vencidos | Acciones pasadas se muestran vencidas sin mutar datos mediante GET | PENDIENTE | Captura |
| SALES-01 | Pipeline | Recalcular puntajes | Actualiza puntajes sin duplicar actividad | PENDIENTE | Captura |
| SALES-02 | Pipeline | Filtrar curso y responsable | Columnas muestran contactos correctos | PENDIENTE | Captura |
| SALES-03 | Pipeline | Mover oportunidad a cliente o perdido | Cambia de columna y audita | PENDIENTE | Antes/después |
| MSG-01 | Mensajes | Procesar pendientes sin credenciales | Estado SIMULADO, nunca ENVIADO | PENDIENTE | Captura |
| MSG-02 | Mensajes | Cancelar programado | Estado CANCELADO | PENDIENTE | Captura |
| MSG-03 | Mensajes | Reintentar fallido/simulado | Un solo intento adicional | PENDIENTE | Contador/estado |
| MSG-04 | Plantillas | Crear con `{{courseUrl}}` | Plantilla válida y URL específica al renderizar | PENDIENTE | Captura |
| SOCIAL-01 | Cuentas | Crear, editar y desactivar cuenta ficticia | Estados correctos | PENDIENTE | Capturas |
| SOCIAL-02 | Publicaciones | Crear borrador | Estado BORRADOR | PENDIENTE | Fila |
| SOCIAL-03 | Publicaciones | Programar y reprogramar | Hora mostrada en America/Guayaquil | PENDIENTE | Capturas |
| SOCIAL-04 | Publicaciones | Editar, duplicar y cancelar | Cada acción persiste y audita | PENDIENTE | Fila/auditoría |
| SOCIAL-05 | Publicaciones | Publicar localmente | Estado SIMULADO; no aparece contenido real | PENDIENTE | Captura |
| SOCIAL-06 | Recurrencia | Crear recurrencia semanal | Próxima ejecución correcta y sin duplicados | PENDIENTE | Captura |
| MOODLE-01 | Moodle | Llamar webhook sin firma HMAC | Responde 401 | PENDIENTE | Respuesta HTTP |
| MOODLE-02 | Moodle | Repetir `eventId` ficticio con firma válida | Segunda respuesta indica duplicado | PENDIENTE | Respuestas |
| MOODLE-03 | Moodle | Alterar un byte después de firmar el cuerpo | Responde 401 | PENDIENTE | Respuesta HTTP |
| FIN-01 | Finance | Completar curso localmente | Finalización registrada y handoff simulado | PENDIENTE | Detalle/auditoría |
| FIN-02 | Finance | Completar dos cursos del mismo contacto | Dos estados y referencias independientes | PENDIENTE | Tabla |
| FIN-03 | Finance | Reintentar un error ficticio | Conserva inscripción e incrementa intentos | PENDIENTE | Captura |
| ROLE-01 | Roles | Recorrer panel como MARKETING | Solo cursos, mensajes, redes y lectura autorizada | PENDIENTE | Video |
| ROLE-02 | Roles | Recorrer panel como VENTAS | Contactos, agenda, pipeline y mensajes autorizados | PENDIENTE | Video |
| ROLE-03 | Roles | Recorrer panel como LECTURA | Sin acciones destructivas | PENDIENTE | Video |
| AUDIT-01 | Auditoría | Filtrar acción, entidad y resultado | Eventos esperados sin secretos | PENDIENTE | Captura |
| RESP-01 | Responsive | Revisar 1440 px, 768 px y 390 px | Menú, filtros, tarjetas, tablas y diálogos utilizables | PENDIENTE | Tres capturas |
| A11Y-01 | Accesibilidad | Navegar con teclado | Focus visible, labels y orden lógico | PENDIENTE | Video corto |
| A11Y-02 | Accesibilidad | Revisar errores de formulario | Mensajes asociados y no dependen solo del color | PENDIENTE | Captura |
