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

describe("gestión de la conversación", () => {
  it("permite vincular, asignar y cerrar o reabrir la atención", () => {
    expect(inbox).toContain('actualizarConversacion({ leadId }');
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
