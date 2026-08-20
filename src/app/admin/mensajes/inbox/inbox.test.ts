import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { etiquetaDeEstado, etiquetaDeTipo, mensajeDeError } from "./mensajes-de-error";
import { PLANTILLAS_DE_BANDEJA } from "@/lib/whatsapp/inbox-templates";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";

/**
 * Bandeja de WhatsApp.
 *
 * Lo que se comprueba aqui son las decisiones que, si fallan, tienen coste
 * real: mandar dos mensajes por un doble clic, perder lo que alguien estaba
 * escribiendo, o ofrecer una plantilla que el servidor va a rechazar.
 */
const inbox = readFileSync(join(process.cwd(), "src/app/admin/mensajes/inbox/WhatsAppInbox.tsx"), "utf8");
const pagina = readFileSync(join(process.cwd(), "src/app/admin/mensajes/page.tsx"), "utf8");
const nav = readFileSync(join(process.cwd(), "src/app/admin/AdminNav.tsx"), "utf8");

describe("integración con el panel existente", () => {
  it("es una vista más de /admin/mensajes, no otra aplicación", () => {
    expect(pagina).toContain('filters.vista === "inbox"');
    expect(pagina).toContain("<WhatsAppInbox />");
    expect(nav).toContain("/admin/mensajes?vista=inbox");
  });

  it("las vistas anteriores siguen resolviéndose", () => {
    // Integraciones y el historial por defecto no pueden haberse perdido al
    // insertar la nueva rama.
    expect(pagina).toContain('filters.vista === "integraciones"');
    expect(pagina).toContain("<WhatsAppTestPanel />");
    expect(pagina).toContain("<MessageList");
  });

  it("consume solo las APIs ya existentes", () => {
    expect(inbox).toContain("/api/admin/whatsapp/conversations");
    expect(inbox).toContain("/reply");
    expect(inbox).toContain("/read");
    // Nada de hablar con Meta desde el navegador.
    expect(inbox).not.toContain("graph.facebook.com");
  });
});

describe("plantillas ofrecidas", () => {
  it("son las once del journey, nunca la oferta institucional", () => {
    // El servidor tambien la rechaza, pero ofrecer un boton que siempre falla
    // es una trampa para quien atiende.
    expect(PLANTILLAS_DE_BANDEJA).toHaveLength(11);
    expect(PLANTILLAS_DE_BANDEJA.map((p) => p.key)).not.toContain("certification_offer");
    expect(inbox).not.toContain("certification_offer");
  });

  it("los nombres de Meta no se reescriben en la interfaz", () => {
    // Duplicarlos es como acaban divergiendo del catalogo.
    expect(inbox).not.toContain("ra_training_");
    for (const p of PLANTILLAS_DE_BANDEJA) {
      expect(WHATSAPP_TEMPLATES[p.key]).toBeDefined();
      expect(p.variables).toEqual(WHATSAPP_TEMPLATES[p.key].bodyVars);
    }
  });

  it("cada una tiene etiqueta legible, no su clave técnica", () => {
    for (const p of PLANTILLAS_DE_BANDEJA) {
      expect(p.label).not.toMatch(/_/);
      expect(p.label.length).toBeGreaterThan(3);
    }
  });
});

describe("envío sin duplicados", () => {
  it("la identidad del intento se genera una vez y no se regenera al fallar", () => {
    // Regenerarla tras un error ambiguo mandaria un segundo WhatsApp a la
    // misma persona: es justo lo que `clientRequestId` evita.
    expect(inbox).toContain("if (!intento.current) intento.current =");
    const catchDeEnvio = inbox.slice(inbox.indexOf("No se pudo confirmar el envío"));
    expect(catchDeEnvio.slice(0, 200)).not.toContain("intento.current =");
  });

  it("solo se libera la identidad cuando el envío se confirma", () => {
    const exito = inbox.slice(inbox.indexOf("intento.current = null;"));
    expect(exito).toContain("setBorrador(\"\")");
  });

  it("el botón se bloquea mientras se envía", () => {
    expect(inbox).toContain("disabled={enviando");
    expect(inbox).toContain("if (!detalle || enviando) return;");
  });

  it("Enter envía y Shift+Enter salta de línea", () => {
    expect(inbox).toContain('if (event.key === "Enter" && !event.shiftKey)');
    expect(inbox).toContain("event.preventDefault()");
  });

  it("un duplicado reconocido por el servidor no se muestra como error", () => {
    expect(inbox).toContain('json.duplicate ? "Ese mensaje ya se había enviado."');
  });
});

describe("ventana de atención", () => {
  it("con la ventana abierta se escribe texto libre", () => {
    expect(inbox).toContain("ventana?.open ? (");
    expect(inbox).toContain("id=\"inbox-texto\"");
  });

  it("con la ventana cerrada se ofrece plantilla en lugar de texto", () => {
    expect(inbox).toContain("WhatsApp cerró la ventana de atención");
    expect(inbox).toContain("Enviar plantilla");
  });

  it("la ventana viene del servidor, no se recalcula aquí", () => {
    // Un calculo propio se desincronizaria del que decide el envio.
    expect(inbox).toContain("v.remainingSeconds");
    expect(inbox).not.toContain("24 * 60 * 60");
  });
});

describe("refresco periódico", () => {
  it("se pausa con la pestaña oculta", () => {
    expect(inbox).toContain('document.visibilityState !== "visible"');
  });

  it("no es cada segundo", () => {
    expect(inbox).toContain("POLLING_MS = 12_000");
  });

  it("el refresco no toca el borrador ni la conversación abierta", () => {
    // Perder lo que alguien esta escribiendo por una recarga automatica seria
    // imperdonable, asi que el tick solo recarga datos.
    const tick = inbox.slice(inbox.indexOf("const tick = () =>"), inbox.indexOf("window.setInterval"));
    expect(tick).not.toContain("setBorrador");
    expect(tick).not.toContain("setSeleccionada");
  });

  it("el detalle se recarga en modo silencioso para no parpadear", () => {
    expect(inbox).toContain("cargarDetalle(seleccionada, true)");
  });
});

describe("scroll y lectura", () => {
  it("solo baja solo si quien lee ya estaba abajo", () => {
    expect(inbox).toContain("if (nodo && pegadoAbajo.current && detalle) nodo.scrollTop = nodo.scrollHeight");
    expect(inbox).toContain("pegadoAbajo.current = nodo.scrollHeight - nodo.scrollTop - nodo.clientHeight < 80");
  });

  it("marcar leído ocurre una vez por conversación, no en cada render", () => {
    expect(inbox).toContain("leidas.current.has(id)");
    expect(inbox).toContain("leidas.current.add(id)");
  });

  it("un aviso de Meta no se muestra como error rojo", () => {
    expect(inbox).toContain('tipo: "ok", texto: "Leído en el CRM; WhatsApp no confirmó la lectura."');
  });
});

describe("seguridad de la interfaz", () => {
  it("no interpreta HTML del contacto", () => {
    expect(inbox).not.toContain("dangerouslySetInnerHTML");
  });

  it("no guarda nada en almacenamiento local", () => {
    expect(inbox).not.toMatch(/localStorage|sessionStorage/);
  });

  it("no maneja tokens ni secretos", () => {
    expect(inbox).not.toMatch(/accessToken|appSecret|verifyToken|Bearer/);
  });

  it("no permite forzar la vinculación cuando el teléfono no coincide", () => {
    expect(inbox).not.toContain("force");
    expect(inbox).toContain("onVincular");
  });

  it("cancela la petición anterior al cambiar de conversación", () => {
    expect(inbox).toContain("abortRef.current?.abort()");
  });
});

describe("mensajes de error legibles", () => {
  it("cada código del backend tiene su texto", () => {
    for (const codigo of [
      "CONVERSATION_NOT_LINKED", "WINDOW_CLOSED_TEMPLATE_REQUIRED", "TEMPLATE_UNKNOWN",
      "TEMPLATE_CAMPAIGN_ONLY", "TEMPLATE_CONTEXT_MISSING", "CONTEXT_FOREIGN",
      "ENROLLMENT_MISMATCH", "PHONE_MISMATCH", "ADMIN_INVALID",
    ]) {
      const texto = mensajeDeError(codigo);
      expect(texto, codigo).not.toBe(codigo);
      expect(texto.length, codigo).toBeGreaterThan(15);
    }
  });

  it("un código desconocido cae en un texto útil, no en JSON crudo", () => {
    expect(mensajeDeError("ALGO_RARO")).toContain("Vuelve a intentarlo");
    expect(mensajeDeError(null, "El servidor lo explicó así")).toBe("El servidor lo explicó así");
  });

  it("el límite de frecuencia se muestra en palabras", () => {
    expect(inbox).toContain("Demasiadas respuestas seguidas");
  });
});

describe("adjuntos y estados", () => {
  it("cada tipo se nombra sin prometer una vista previa que no existe", () => {
    expect(etiquetaDeTipo("image", null)).toBe("Imagen");
    expect(etiquetaDeTipo("document", { filename: "guia.pdf" })).toContain("guia.pdf");
    expect(etiquetaDeTipo("audio", null)).toBe("Audio");
    expect(etiquetaDeTipo("video", null)).toBe("Video");
    expect(etiquetaDeTipo("location", { name: "Quito" })).toContain("Quito");
    expect(etiquetaDeTipo("contacts", null)).toBe("Contacto compartido");
    expect(etiquetaDeTipo("reaction", null)).toBe("Reacción");
    expect(etiquetaDeTipo("holograma", null)).toBe("Mensaje no compatible");
  });

  it("el texto no lleva etiqueta de tipo: el mensaje habla por sí solo", () => {
    expect(etiquetaDeTipo("text", null)).toBe("");
  });

  it("los estados se leen en palabras, no como constantes", () => {
    expect(etiquetaDeEstado("ENTREGADO")).toBe("Entregado");
    expect(etiquetaDeEstado("LEIDO")).toBe("Leído");
    expect(etiquetaDeEstado("FALLIDO")).toBe("No se pudo enviar");
    expect(etiquetaDeEstado("ENVIANDO")).toBe("Enviando…");
    expect(etiquetaDeEstado(null)).toBe("");
  });

  it("no se muestra la respuesta cruda del proveedor", () => {
    expect(inbox).not.toContain("providerResponse");
  });
});

describe("estados vacíos y navegación", () => {
  it("cubre lista vacía, búsqueda sin resultados y conversación sin mensajes", () => {
    expect(inbox).toContain("Todavía no hay conversaciones de WhatsApp");
    expect(inbox).toContain("Ninguna conversación coincide con la búsqueda");
    expect(inbox).toContain("Esta conversación todavía no tiene mensajes");
    expect(inbox).toContain("Sin inscripciones registradas");
  });

  it("hay estado de carga y de error en lista y detalle", () => {
    expect(inbox).toContain("Cargando conversaciones…");
    expect(inbox).toContain("Cargando conversación…");
    expect(inbox).toContain("No se pudo cargar la bandeja.");
    expect(inbox).toContain("No se pudo cargar la conversación.");
  });

  it("en móvil se navega entre paneles con un botón de volver", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(inbox).toContain("← Conversaciones");
    expect(css).toContain(".inbox-shell.has-selection .inbox-list { display: none; }");
    expect(css).toContain("@media (max-width: 900px)");
  });

  it("los controles tienen etiqueta accesible", () => {
    expect(inbox).toContain('aria-label="Buscar conversaciones"');
    expect(inbox).toContain('aria-label="Filtrar conversaciones"');
    expect(inbox).toContain('aria-label="Mensajes"');
    expect(inbox).toContain('role="status"');
  });
});

/**
 * Hallazgo del release de estabilización: "Información" ya conmutaba
 * `panelInfo`, pero en escritorio el panel era una tercera columna del grid
 * siempre visible -el botón parecía no hacer nada-. Ahora es un drawer
 * superpuesto, igual en cualquier ancho de pantalla.
 */
describe("Información es un drawer real, no una columna permanente", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("el grid de escritorio ya no reserva una tercera columna fija para el panel", () => {
    expect(css).toContain(".inbox-shell {");
    expect(css).not.toMatch(/grid-template-columns:\s*minmax\(240px,\s*320px\)\s*minmax\(0,\s*1fr\)\s*minmax\(240px,\s*300px\)/);
  });

  it(".inbox-info está oculto por defecto y solo aparece con shows-info", () => {
    const bloque = css.slice(css.indexOf(".inbox-info {"), css.indexOf(".inbox-info {") + 400);
    expect(bloque).toMatch(/display:\s*none/);
    expect(bloque).toMatch(/position:\s*fixed/);
    expect(css).toContain(".inbox-shell.shows-info .inbox-info { display: flex; }");
  });

  it("esa regla no depende de un @media: abre igual en escritorio y en móvil", () => {
    // Ancla en el bloque del inbox: el archivo tiene otros @media 900px
    // ajenos, buscar el primero del archivo entero daría un falso negativo.
    const inicioInbox = css.indexOf(".inbox-shell {");
    const mediaDelInbox = css.indexOf("@media (max-width: 900px)", inicioInbox);
    const regla = css.indexOf(".inbox-shell.shows-info .inbox-info { display: flex; }", inicioInbox);
    expect(regla).toBeGreaterThan(-1);
    expect(mediaDelInbox).toBeGreaterThan(-1);
    expect(regla).toBeLessThan(mediaDelInbox);
  });

  it("un fondo clicable cierra el panel sin necesitar el botón de nuevo", () => {
    expect(inbox).toContain('className="inbox-info-backdrop"');
    expect(inbox).toContain("onClick={() => setPanelInfo(false)}");
    expect(css).toContain(".inbox-shell.shows-info .inbox-info-backdrop { display: block; }");
  });
});

describe("gestión de la conversación", () => {
  it("permite vincular (existente o nuevo), asignar y cerrar o reabrir la atención", () => {
    expect(inbox).toContain("JSON.stringify({ leadId, ...(confirmarNuevoNumero ? { confirmPhoneUpdate: true } : {}) })");
    expect(inbox).toContain("/create-contact");
    expect(inbox).toContain('{ state: "RESOLVED" }');
    expect(inbox).toContain('{ state: "HUMAN_HANDOFF" }');
  });

  it("explica qué implica la atención humana", () => {
    expect(inbox).toContain("los mensajes comerciales automáticos se pausan");
    expect(inbox).toContain("Los recordatorios operativos continúan");
  });

  it("ofrece elegir inscripción solo cuando hay más de una", () => {
    expect(inbox).toContain("inscripciones.length > 1");
  });

  it("enlaza a la ficha completa del contacto", () => {
    // Se busca el prefijo: el resto es una interpolación del componente.
    expect(inbox).toContain("/admin/leads/");
  });
});

/**
 * Secciones V y W del release de estabilización: un contacto sin vincular
 * dejaba de ser un callejón sin salida. El modal ofrece buscar uno existente
 * o crear uno nuevo, y si el número no coincide se pide confirmación
 * explícita en vez de vincular en silencio o rechazar sin salida.
 */
describe("vincular contacto sin vínculo (secciones V y W)", () => {
  it("ofrece las dos rutas: contacto existente y contacto nuevo", () => {
    expect(inbox).toContain("Contacto existente");
    expect(inbox).toContain("Contacto nuevo");
    expect(inbox).toContain('useState<"buscar" | "crear">("buscar")');
  });

  it("la búsqueda usa el endpoint dedicado, no el listado general de leads", () => {
    expect(inbox).toContain("/api/admin/whatsapp/contacts-search?q=");
    expect(inbox).not.toContain("/api/admin/leads?search=");
  });

  it("un teléfono que no coincide no se vincula en silencio: pide confirmación aparte", () => {
    const tabBuscar = inbox.slice(inbox.indexOf("function BuscarContactoTab"), inbox.indexOf("function CrearContactoTab"));
    expect(tabBuscar).toContain('json?.errorCode === "PHONE_MISMATCH" && !confirmarNuevoNumero');
    // El rechazo solo guarda el conflicto en estado; no hay un segundo fetch
    // automático dentro de esa misma rama.
    const ramaRechazo = tabBuscar.slice(tabBuscar.indexOf('if (json?.errorCode === "PHONE_MISMATCH"'), tabBuscar.indexOf("setConflictoId(null);"));
    expect(ramaRechazo).toContain("setConflictoId(leadId)");
    expect(ramaRechazo).not.toContain("fetch(");
    expect(tabBuscar).toContain("Este contacto está registrado con otro número");
    // El botón de confirmar solo existe dentro del bloque que ya detectó el conflicto.
    const bloqueConflicto = tabBuscar.slice(tabBuscar.indexOf("conflictoId === contacto.id ?"), tabBuscar.indexOf(") : ("));
    expect(bloqueConflicto).toContain("Usar este nuevo número y vincular");
    expect(bloqueConflicto).toContain("vincular(contacto.id, true)");
  });

  it("crear contacto nuevo fija el teléfono de la conversación, no lo deja editar", () => {
    const tabCrear = inbox.slice(inbox.indexOf("function CrearContactoTab"));
    expect(tabCrear).toContain("<span>Teléfono</span>");
    expect(tabCrear).toContain("<input value={phone} disabled />");
  });

  it("solo el nombre es obligatorio en el alta; correo, curso y responsable son opcionales", () => {
    const tabCrear = inbox.slice(inbox.indexOf("function CrearContactoTab"));
    expect(tabCrear).toContain("Nombre completo <strong aria-hidden=\"true\">*</strong>");
    expect(tabCrear).toContain("Correo electrónico <small>(opcional)</small>");
    expect(tabCrear).toContain("Curso de interés <small>(opcional)</small>");
    expect(tabCrear).toContain("Responsable <small>(opcional)</small>");
    expect(tabCrear).toContain("disabled={creando || !fullName.trim()}");
  });

  it("avisa que el contacto creado desde WhatsApp no entra solo en automatizaciones comerciales", () => {
    const tabCrear = inbox.slice(inbox.indexOf("function CrearContactoTab"));
    expect(tabCrear).toContain("no aceptó recibir comunicación comercial");
    expect(tabCrear).toContain("confirm: true");
  });

  it("el modal se cierra con X, Escape o cancelar, igual que los demás diálogos del admin", () => {
    const panel = inbox.slice(inbox.indexOf("function ContactoSinVincular"), inbox.indexOf("type ContactoEncontrado"));
    expect(panel).toContain('if (event.key === "Escape")');
    expect(panel).toContain("admin-dialog-close");
    expect(panel).toContain("onCancel={(event) => {");
  });

  it("nunca manda el teléfono editable al servidor: solo se envía leadId/confirmPhoneUpdate o lo que define create-contact", () => {
    // El input de telefono en "crear nuevo" esta deshabilitado y no forma
    // parte del cuerpo JSON que se manda: el servidor usa el suyo propio.
    const tabCrear = inbox.slice(inbox.indexOf("function CrearContactoTab"));
    const cuerpoPeticion = tabCrear.slice(tabCrear.indexOf("body: JSON.stringify({"), tabCrear.indexOf("});"));
    expect(cuerpoPeticion).not.toContain("phone");
  });
});

/**
 * Sección U del release de estabilización: la bandeja tenía la mecánica bien
 * (drawer, ventana, envío sin duplicados) pero cero pulido visual -CSS sin
 * colores, sin avatar, sin agrupar mensajes seguidos-. Esto comprueba que el
 * pulido llegó y que usa la paleta de marca, no el verde de WhatsApp.
 */
describe("rediseño visual de la bandeja (sección U)", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  it("cada fila de la lista tiene un avatar con inicial", () => {
    expect(inbox).toContain("function inicialDe(nombre: string): string");
    expect(inbox).toContain('<span className="inbox-avatar"');
    expect(css).toContain(".inbox-avatar {");
  });

  it("los mensajes seguidos del mismo origen se agrupan sin repetir la cabecera", () => {
    expect(inbox).toContain("function agrupadoConAnterior(actual: Mensaje, anterior: Mensaje | undefined): boolean");
    // Se compara con el mensaje inmediatamente anterior de la MISMA conversación.
    expect(inbox).toContain("agrupadoConAnterior(m, detalle.messages[indice - 1])");
    expect(inbox).toContain("{!agrupado ? (");
  });

  it("una burbuja humana se distingue de una automática, no solo por el texto", () => {
    expect(inbox).toContain('m.origin === "HUMAN" ? "is-human" : ""');
    expect(css).toContain(".bubble.is-outbound.is-human {");
  });

  it("usa la paleta de marca (azul/blanco/gris), no el verde de WhatsApp", () => {
    const bloqueInbox = css.slice(css.indexOf("Inbox de WhatsApp."), css.indexOf("@media (max-width: 900px)", css.indexOf("Inbox de WhatsApp.")));
    expect(bloqueInbox).not.toMatch(/#25d366|#128c7e|#075e54/i);
    expect(bloqueInbox).toContain("var(--brand-primary)");
  });

  it("lo no leído es el único acento en naranja, y solo dentro de la bandeja", () => {
    expect(css).toContain(".inbox-item .badge {");
    const bloqueBadge = css.slice(css.indexOf(".inbox-item .badge {"), css.indexOf(".inbox-item .badge {") + 200);
    expect(bloqueBadge).toContain("var(--brand-accent)");
  });

  it("el drawer de información sigue oculto por defecto tras el rediseño", () => {
    // Repite la comprobación estructural: un rediseño visual no puede
    // reintroducir la columna fija que ya se corrigió antes.
    const bloque = css.slice(css.indexOf(".inbox-info {"), css.indexOf(".inbox-info {") + 400);
    expect(bloque).toMatch(/display:\s*none/);
    expect(bloque).toMatch(/position:\s*fixed/);
  });
});
