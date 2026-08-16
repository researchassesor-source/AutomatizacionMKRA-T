import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESTADO_CAMPANA,
  etiquetaComercial,
  etiquetaOferta,
  puedeEnviar,
  puedeSeleccionarse,
  seleccionablesDe,
  textoConfirmacion,
  type DestinatarioVista,
} from "./offer-presentation";

/**
 * Pantalla de la oferta institucional.
 *
 * La logica de presentacion se prueba de verdad, como funciones puras. El
 * cableado del componente —a que endpoint llama, que deshabilita, si confirma—
 * se comprueba leyendo el fuente: el proyecto no tiene jsdom ni
 * testing-library, y añadir un stack de DOM entero para esto costaria mas de lo
 * que aporta frente a extraer la logica, que es lo que se ha hecho.
 */
const panel = readFileSync(join(process.cwd(), "src/app/admin/cursos/[id]/InstitutionalOfferPanel.tsx"), "utf8");
const pagina = readFileSync(join(process.cwd(), "src/app/admin/cursos/[id]/page.tsx"), "utf8");

const base: DestinatarioVista = {
  enrollmentId: "e1",
  telefono: "+593987654321",
  estado: "PENDING",
  estadoComercial: null,
  seleccionado: false,
  excluido: false,
  enviadoManual: null,
  enviadoAutomatico: null,
};
const persona = (parcial: Partial<DestinatarioVista> = {}): DestinatarioVista => ({ ...base, ...parcial });

describe("modo histórico", () => {
  it("el aviso dice que el automático está desactivado", () => {
    expect(panel).toContain("Campaña histórica — envío automático desactivado");
    expect(panel).toContain("Selecciona manualmente las personas");
  });

  it("un LEGACY_UNCLASSIFIED sigue siendo seleccionable", () => {
    // En cursos anteriores no existe CRMCompras: ese estado no puede bloquear.
    const historico = persona({ estadoComercial: "LEGACY_UNCLASSIFIED" });
    expect(puedeSeleccionarse(historico, true)).toBe(true);
    expect(etiquetaComercial("LEGACY_UNCLASSIFIED", "HISTORICAL_MANUAL")).toBe("Histórico — revisión manual");
  });

  it("el estado comercial no altera la selección en histórico", () => {
    // Ni «ya compró», ni pago pendiente, ni ausencia de dato: decide la persona.
    for (const estado of ["FULL_VERIFIED", "INSTITUTIONAL_PENDING", "NO_PURCHASE", null]) {
      expect(puedeSeleccionarse(persona({ estadoComercial: estado }), true), String(estado)).toBe(true);
    }
  });

  it("sin dato de Finance se dice «Histórico — sin dato», no «sin compra»", () => {
    // Decir "sin compra" seria afirmar algo que nadie ha comprobado.
    expect(etiquetaComercial(null, "HISTORICAL_MANUAL")).toBe("Histórico — sin dato");
    expect(etiquetaComercial(null, "AUTOMATIC_COMMERCE")).toBe("Sin consultar");
  });

  it("el panel no deduce compradores por importe ni por estado de inscripción", () => {
    expect(panel).not.toMatch(/\bamount\b|financeStatus|"INSCRITO"|"PENDIENTE"/);
  });
});

describe("qué queda bloqueado", () => {
  it("quien ya recibió el envío manual no puede volver a marcarse", () => {
    expect(puedeSeleccionarse(persona({ enviadoManual: "2026-09-01T10:00:00Z" }), true)).toBe(false);
    expect(etiquetaOferta(persona({ enviadoManual: "x" })).texto).toBe("Enviado manualmente");
  });

  it("quien ya recibió el automático tampoco", () => {
    expect(puedeSeleccionarse(persona({ enviadoAutomatico: "2026-09-01T10:00:00Z" }), true)).toBe(false);
    expect(etiquetaOferta(persona({ enviadoAutomatico: "x" })).texto).toBe("Enviado automáticamente");
  });

  it("un excluido no se puede marcar hasta restaurarlo", () => {
    expect(puedeSeleccionarse(persona({ excluido: true }), true)).toBe(false);
    expect(etiquetaOferta(persona({ excluido: true })).texto).toBe("Excluido");
  });

  it("sin WhatsApp no se puede seleccionar", () => {
    expect(puedeSeleccionarse(persona({ telefono: null }), true)).toBe(false);
    expect(panel).toContain("Sin WhatsApp");
  });

  it("lo ya enviado manda sobre lo que diga Finance", () => {
    const enviadoYcomprado = persona({ enviadoManual: "x", estado: "NOT_ELIGIBLE_PURCHASED" });
    expect(etiquetaOferta(enviadoYcomprado).texto).toBe("Enviado manualmente");
  });

  it("«Seleccionar todos» solo marca a quien puede recibirla", () => {
    const lista = [
      persona({ enrollmentId: "ok" }),
      persona({ enrollmentId: "enviado", enviadoManual: "x" }),
      persona({ enrollmentId: "excluido", excluido: true }),
      persona({ enrollmentId: "sin-telefono", telefono: null }),
      persona({ enrollmentId: "auto", enviadoAutomatico: "x" }),
    ];
    expect(seleccionablesDe(lista, true)).toEqual(["ok"]);
  });
});

describe("permisos", () => {
  it("sin permiso de edición no se puede marcar a nadie", () => {
    expect(puedeSeleccionarse(persona(), false)).toBe(false);
    expect(seleccionablesDe([persona()], false)).toEqual([]);
  });

  it("el panel muestra modo lectura y usa el rol existente del CRM", () => {
    expect(panel).toContain("solo lectura");
    expect(pagina).toContain("canEdit={canEdit}");
    // No inventa un sistema de roles nuevo.
    expect(panel).not.toMatch(/session\.role|AdminRole/);
  });

  it("ninguna mutación se ejecuta sin permiso", () => {
    expect(panel).toMatch(/if \(ocupado \|\| !canEdit\) return null;/);
  });
});

describe("envío", () => {
  it("falta la URL de la oferta y el envío queda bloqueado", () => {
    expect(puedeEnviar({ puedeEditar: true, urlOferta: null, marcados: ["e1"], ocupado: false })).toBe(false);
    expect(puedeEnviar({ puedeEditar: true, urlOferta: "   ", marcados: ["e1"], ocupado: false })).toBe(false);
    expect(panel).toContain("Falta configurar el enlace de la oferta institucional");
  });

  it("sin nadie marcado no se puede enviar", () => {
    expect(puedeEnviar({ puedeEditar: true, urlOferta: "https://x.test/o", marcados: [], ocupado: false })).toBe(false);
  });

  it("con URL y selección sí se puede", () => {
    expect(puedeEnviar({ puedeEditar: true, urlOferta: "https://x.test/o", marcados: ["e1"], ocupado: false })).toBe(true);
  });

  it("mientras procesa no se puede volver a pulsar", () => {
    // Es la proteccion visual del doble clic; el backend tiene la definitiva.
    expect(puedeEnviar({ puedeEditar: true, urlOferta: "https://x.test/o", marcados: ["e1"], ocupado: true })).toBe(false);
    expect(panel).toMatch(/if \(ocupado \|\| !canEdit\) return null;/);
    expect(panel).toContain("setOcupado(true)");
  });

  it("la confirmación dice a cuántas personas se va a escribir", () => {
    const texto = textoConfirmacion({ marcados: 51, enviadosManualmente: 12, excluidos: 3, pendientes: 48 });
    expect(texto).toContain("51 participante(s)");
    expect(texto).toContain("Ya enviados: 12");
    expect(texto).toContain("Excluidos: 3");
    expect(texto).toContain("Pendientes: 48");
  });

  it("un error de la API no marca a nadie como enviado ni borra la selección", () => {
    const manejo = panel.slice(panel.indexOf("if (!respuesta.ok)"), panel.indexOf("await cargar()"));
    expect(manejo).toContain("No se pudo completar la acción");
    expect(manejo).not.toContain("setMarcados");
    // La seleccion solo se limpia cuando el envio devolvio resultado.
    expect(panel).toMatch(/if \(resultado\) setMarcados\(\[\]\)/);
  });

  it("no se supone el éxito: se recarga desde el servidor", () => {
    expect(panel).toMatch(/\/\/ Se recarga desde el servidor en vez de suponer el resultado\.\s*await cargar\(\)/);
  });
});

describe("modo automático", () => {
  it("muestra la fecha del envío automático", () => {
    expect(panel).toContain("Envío automático:");
    expect(panel).toMatch(/campana\.automaticScheduledAt/);
  });

  it("solo la muestra cuando la campaña es automática", () => {
    expect(panel).toMatch(/!historica && campana\.automaticScheduledAt/);
  });

  it("traduce los estados reales de la campaña", () => {
    expect(ESTADO_CAMPANA).toMatchObject({
      DRAFT: "Preparada", SCHEDULED: "Programada", RUNNING: "Procesando",
      COMPLETED: "Ejecutada", CANCELLED: "Cancelada",
    });
  });

  it("quien recibió el manual deja de contar como pendiente", () => {
    // El contador lo calcula el backend; aqui se comprueba que la etiqueta y el
    // bloqueo son coherentes con eso.
    const manual = persona({ enviadoManual: "x" });
    expect(puedeSeleccionarse(manual, true)).toBe(false);
    expect(etiquetaOferta(manual).texto).toBe("Enviado manualmente");
  });

  it("en automático sí se informa de la compra registrada", () => {
    expect(etiquetaComercial("FULL_VERIFIED", "AUTOMATIC_COMMERCE")).toBe("Completa · pagada");
    expect(etiquetaOferta(persona({ estado: "NOT_ELIGIBLE_PURCHASED" })).texto).toBe("Ya compró");
    expect(etiquetaOferta(persona({ estado: "NOT_ELIGIBLE_PENDING_PAYMENT" })).texto).toBe("Pago pendiente");
  });
});

describe("integración con el backend", () => {
  it("consume los endpoints reales, sin duplicar elegibilidad", () => {
    expect(panel).toContain("/api/admin/commerce/campaign?courseId=");
    expect(panel).toMatch(/fetch\("\/api\/admin\/commerce\/campaign"/);
    // Toda la decision vive en el servidor.
    expect(panel).not.toMatch(/decidirManual|decidirAutomatico|NO_PURCHASE/);
  });

  it("usa las acciones que el endpoint entiende", () => {
    for (const accion of ["crear", "seleccionar", "excluir", "restaurar", "enviar"]) {
      expect(panel, accion).toContain(`accion: "${accion}"`);
    }
  });

  it("la selección se persiste en el backend, no solo en React", () => {
    // Guardarla solo en memoria borraria el trabajo de elegir a mano al recargar.
    expect(panel).toMatch(/accion: "seleccionar", campaignId: campana\.id/);
  });

  it("los contadores vienen del endpoint, no se recalculan en pantalla", () => {
    expect(panel).toMatch(/contadores\.participantes/);
    expect(panel).toMatch(/contadores\.requierenRevision/);
  });

  it("permite crear la campaña eligiendo el modo, sin adivinarlo", () => {
    expect(panel).toContain('audienceMode: "HISTORICAL_MANUAL"');
    expect(panel).toContain('audienceMode: "AUTOMATIC_COMMERCE"');
  });
});

describe("no se mezcla con los once mensajes", () => {
  it("es una sección aparte dentro de Comunicaciones", () => {
    expect(pagina).toContain("<InstitutionalOfferPanel courseId={course.id}");
    // El recorrido de los once sigue en su propio panel, antes.
    expect(pagina).toContain("<CourseTimeline");
  });

  it("el panel no toca el plan ni las reglas de automatización", () => {
    expect(panel).not.toMatch(/automationRule|DEFAULT_AUTOMATION_PLAN|planKey/);
  });
});
