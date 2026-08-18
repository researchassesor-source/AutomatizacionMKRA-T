import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describirMomento } from "./CourseCommunicationsManager";

/**
 * Panel operativo de Comunicaciones.
 *
 * `describirMomento` es pura y se prueba de verdad. El resto del cableado —a
 * que endpoint llama cada boton, que deja de mostrarse sin permiso, que el
 * WhatsApp nunca manda un textarea— se comprueba leyendo el fuente, como en
 * el resto del proyecto: no hay jsdom ni testing-library instalados.
 */
const fuente = readFileSync(join(process.cwd(), "src/app/admin/cursos/[id]/CourseCommunicationsManager.tsx"), "utf8");

describe("describirMomento", () => {
  it("al inscribirse no dice '0 minutos'", () => {
    expect(describirMomento({ trigger: "ON_REGISTRATION", offsetMinutes: 0 })).toBe("Al inscribirse");
  });

  it("al iniciar la sesión, sin decir '0 minutos antes'", () => {
    expect(describirMomento({ trigger: "BEFORE_COURSE", offsetMinutes: 0 })).toBe("Justo al empezar la sesión");
  });

  it("los días se agrupan y no se muestran en minutos", () => {
    expect(describirMomento({ trigger: "BEFORE_COURSE", offsetMinutes: 1440 })).toBe("1 día antes de la sesión");
    expect(describirMomento({ trigger: "BEFORE_COURSE", offsetMinutes: 2880 })).toBe("2 días antes de la sesión");
  });

  it("las horas se agrupan cuando el minuto no forma un día completo", () => {
    expect(describirMomento({ trigger: "BEFORE_COURSE", offsetMinutes: 120 })).toBe("2 horas antes de la sesión");
    expect(describirMomento({ trigger: "BEFORE_COURSE", offsetMinutes: 60 })).toBe("1 hora antes de la sesión");
  });

  it("lo que no forma ni horas ni días se muestra en minutos", () => {
    expect(describirMomento({ trigger: "AFTER_COURSE", offsetMinutes: 20 })).toBe("20 minutos después de la sesión");
  });

  it("la relación depende del disparador, no de un texto libre", () => {
    expect(describirMomento({ trigger: "ON_REGISTRATION", offsetMinutes: 5 })).toContain("después de registrarse");
    expect(describirMomento({ trigger: "AFTER_COURSE", offsetMinutes: 5 })).toContain("después de la sesión");
  });
});

describe("WhatsApp como plantilla aprobada, no como texto libre", () => {
  it("el guardado nunca manda asunto ni cuerpo para WhatsApp", () => {
    expect(fuente).toMatch(/esWhatsApp \? \{\} : \{ subject, body \}/);
  });

  it("el único textarea del panel vive en la rama de correo, no en la de WhatsApp", () => {
    const ramaWhatsapp = fuente.slice(fuente.indexOf("esWhatsApp ? ("), fuente.indexOf(") : ("));
    expect(ramaWhatsapp).not.toContain("<textarea");
    expect((fuente.match(/<textarea/g) ?? []).length).toBe(1);
  });

  it("el nombre de la plantilla se muestra, no se edita", () => {
    expect(fuente).toContain("Plantilla: {regla.waTemplateName");
    expect(fuente).toContain("Contenido aprobado en Meta. Se puede cambiar cuándo se envía, no lo que dice.");
  });

  it("el correo sí expone asunto y contenido editables con las variables disponibles", () => {
    expect(fuente).toContain("VARIABLES_DISPONIBLES");
    expect(fuente).toMatch(/id=\{`asunto-\$\{regla\.id\}`\}/);
    expect(fuente).toMatch(/id=\{`cuerpo-\$\{regla\.id\}`\}/);
  });
});

describe("timing en lenguaje humano", () => {
  it("se edita como cantidad + unidad, no como offsetMinutes crudo", () => {
    expect(fuente).not.toMatch(/offsetMinutes\}\s*(onChange|value)/);
    expect(fuente).toContain("<option value=\"minutos\">minutos</option>");
    expect(fuente).toContain("<option value=\"horas\">horas</option>");
    expect(fuente).toContain("<option value=\"dias\">días</option>");
  });

  it("la relación (antes/después) no es un campo editable, la fija el disparador", () => {
    expect(fuente).toContain("La relación la fija el disparador: no se puede elegir una imposible.");
  });

  it("nunca se muestra un número negativo de desfase", () => {
    expect(fuente).toContain("Math.max(0, Math.round(cantidad * factor))");
  });
});

describe("activar / desactivar un paso", () => {
  it("el botón es un switch accesible con el nombre del paso", () => {
    expect(fuente).toMatch(/aria-pressed=\{activo\}/);
    expect(fuente).toMatch(/aria-label=\{`\$\{activo \? "Dejar de enviar" : "Enviar"\}: \$\{paso\.title\}`\}/);
  });

  it("sin permiso no se puede ni pulsar", () => {
    expect(fuente).toMatch(/canEdit && !sinReglas \?/);
    expect(fuente).toMatch(/if \(!canEdit \|\| ocupado\) return;/);
  });

  it("mientras guarda queda deshabilitado, para no duplicar la petición", () => {
    expect(fuente).toMatch(/disabled=\{ocupado === paso\.planKey\}/);
  });

  it("un paso sin regla configurada no ofrece el interruptor", () => {
    expect(fuente).toContain('{sinReglas ? "No configurado" : activo ? "Enviar" : "No enviar"}');
  });
});

describe("enlaces del recorrido", () => {
  it("cada paso que depende de un enlace lo señala y ofrece configurarlo en un clic", () => {
    expect(fuente).toContain("Falta el enlace:");
    expect(fuente).toContain('onClick={() => setEditandoEnlaces(true)}>Configurar</button>');
  });

  it("los tres enlaces del curso se guardan por su propio endpoint", () => {
    expect(fuente).toMatch(/\/api\/admin\/courses\$\{courseId\}\/communication-links/);
  });

  it("el mapeo de pasos a enlaces cubre exactamente los pasos que los necesitan", () => {
    expect(fuente).toMatch(/whatsapp_group: "whatsappGroupUrl"/);
    expect(fuente).toMatch(/course_complete: "courseCompleteUrl"/);
    expect(fuente).toMatch(/course_follow_up: "courseCompleteUrl"/);
    expect(fuente).toMatch(/survey: "surveyUrl"/);
  });
});

describe("pausa global del curso", () => {
  it("se muestra como aviso, sin tocar el estado individual de cada paso", () => {
    expect(fuente).toContain("Ahora mismo el curso está pausado, así que no sale ningún mensaje.");
    // El aviso vive en el párrafo de cabecera; no participa en el cálculo de `activo`.
    const calculoActivo = fuente.slice(fuente.indexOf("const activo = estado[paso.planKey]"), fuente.indexOf("const activo = estado[paso.planKey]") + 80);
    expect(calculoActivo).not.toContain("cursoPausado");
  });
});

describe("el paso 12 (oferta institucional) no vive en este panel", () => {
  it("el gestor no referencia certification_offer", () => {
    expect(fuente).not.toContain("certification_offer");
  });

  it("no define su propia lista de pasos: recibe `pasos` ya construidos por el servidor", () => {
    expect(fuente).not.toContain("TIMELINE_STEPS");
  });
});

describe("sin permiso, todo queda en solo lectura", () => {
  it("editar enlaces, alternar un paso y guardar una regla exigen canEdit", () => {
    expect(fuente).toMatch(/canEdit \? \(\s*<button type="button" className="btn-sm ghost" onClick=\{\(\) => setEditandoEnlaces/);
    expect(fuente).toMatch(/if \(!canEdit \|\| guardando\) return;/);
  });

  it("el backend vuelve a exigir el rol aunque la pantalla ya lo oculte", () => {
    const endpoints = [
      join(process.cwd(), "src/app/api/admin/courses/[id]/communications/[planKey]/route.ts"),
      join(process.cwd(), "src/app/api/admin/courses/[id]/communication-links/route.ts"),
    ];
    for (const ruta of endpoints) {
      const contenido = readFileSync(ruta, "utf8");
      expect(contenido, ruta).toContain("requireRole");
    }
  });
});
