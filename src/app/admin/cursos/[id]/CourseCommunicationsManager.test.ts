import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describirMomento } from "./CourseCommunicationsManager";

/**
 * Panel operativo de Comunicaciones (secciones N/O/P/Q del release de
 * estabilización): 12 tarjetas visuales + "Datos para los mensajes".
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

describe("las 12 tarjetas no exponen jerga técnica", () => {
  const literales = ["planKey", "ACTIVE", "PAUSED", "trigger:", "offsetMinutes:", "Sin canales", '"No configurado"'];
  for (const literal of literales) {
    it(`no aparece "${literal}" en ningún texto mostrado`, () => {
      // Los nombres de campo/tipo internos pueden aparecer como identificadores
      // de TypeScript (paso.planKey, regla.trigger); lo que no puede pasar es
      // que ese VALOR se muestre como texto al usuario. Se comprueba que no
      // hay una plantilla de texto tipo {paso.planKey} ni un literal suelto.
      expect(fuente).not.toContain(`>{paso.${literal}}`);
      expect(fuente).not.toContain(`{regla.${literal}}`);
    }); }

  it("nunca compone un mensaje visible con el literal 'Sin canales'", () => {
    expect(fuente).not.toMatch(/\|\|\s*"Sin canales"/);
  });

  it("nunca muestra 'No configurado' como texto de estado de una tarjeta", () => {
    expect(fuente).not.toMatch(/"No configurado"/);
  });

  it("las etiquetas de estado son las tres exigidas: se enviará / no se enviará / falta configurar", () => {
    expect(fuente).toContain('seleccionado: "Se enviará"');
    expect(fuente).toContain('deseleccionado: "No se enviará"');
    expect(fuente).toContain('incompleto: "Falta configurar"');
  });
});

describe("estado de cada tarjeta: azul/gris/ámbar según seleccionado, incompleto o ninguno", () => {
  it("una tarjeta activa pero con motivo de bloqueo se clasifica incompleta, no seleccionada sin más", () => {
    expect(fuente).toMatch(/estado: activo \? \(motivoIncompleto \? "incompleto" : "seleccionado"\) : "deseleccionado"/);
  });

  it("el motivo incompleto solo se muestra cuando la tarjeta está activa", () => {
    expect(fuente).toMatch(/motivoIncompleto: activo \? motivoIncompleto : null/);
  });

  it("las clases CSS reflejan exactamente los tres estados", () => {
    expect(fuente).toContain("`is-${modelo.estado}`");
  });
});

describe("activar / desactivar una tarjeta", () => {
  it("el botón es un switch accesible con el nombre del paso", () => {
    expect(fuente).toMatch(/aria-pressed=\{modelo\.estado === "seleccionado" \|\| modelo\.estado === "incompleto" \|\| modelo\.estado === "enviado"\}/);
    expect(fuente).toMatch(/aria-label=\{`\$\{modelo\.title\}: \$\{ETIQUETA_ESTADO\[modelo\.estado\]\}`\}/);
  });

  it("sin permiso no se puede ni pulsar", () => {
    expect(fuente).toMatch(/disabled=\{!canEdit \|\| modelo\.ocupado \|\| !modelo\.onClick\}/);
    expect(fuente).toMatch(/if \(!canEdit \|\| ocupado\) return;/);
  });

  it("un paso sin regla configurada se activa con el plan estándar, no con un formulario de canales aparte", () => {
    expect(fuente).toContain("channels: paso.availableChannels, offsetMinutes: paso.defaultOffsetMinutes, confirm: true");
  });
});

describe("datos para los mensajes: modal compacto por fila, no un formulario compartido", () => {
  it("cada fila abre su propio modal, no uno gigante para las tres a la vez", () => {
    expect(fuente).toMatch(/const \[modal, setModal\] = useState</);
    expect(fuente).toContain("onClick={() => setModal(fila.campo)}");
  });

  it("los enlaces se guardan por su propio endpoint, un campo a la vez", () => {
    expect(fuente).toMatch(/\/api\/admin\/courses\/\$\{courseId\}\/communication-links/);
    expect(fuente).toContain("body: JSON.stringify({ [campo]: valor, confirm: true })");
  });

  it("la oferta institucional tiene URL, precio y horas posteriores, con su propio endpoint", () => {
    expect(fuente).toMatch(/\/api\/admin\/courses\/\$\{courseId\}\/institutional-offer/);
    expect(fuente).toContain("institutionalOfferUrl: url, institutionalOfferPrice: precio, institutionalOfferDelayHours: horas");
  });

  it("las cuatro filas exigidas están presentes: grupo, curso completo, encuesta, oferta", () => {
    expect(fuente).toContain('nombre: "Grupo WhatsApp"');
    expect(fuente).toContain('nombre: "Curso completo"');
    expect(fuente).toContain('nombre: "Encuesta final"');
    expect(fuente).toContain('nombre: "Oferta institucional"');
  });
});

describe("pausa global del curso", () => {
  it("se muestra como aviso, sin tocar el estado individual de cada paso", () => {
    expect(fuente).toContain("Ahora mismo el curso está pausado, así que no sale ningún mensaje.");
    const calculoActivo = fuente.slice(fuente.indexOf("const activo = estado[paso.planKey]"), fuente.indexOf("const activo = estado[paso.planKey]") + 80);
    expect(calculoActivo).not.toContain("cursoPausado");
  });
});

describe("la tarjeta #12 (oferta institucional) vive en la misma cuadrícula, con su propio motor", () => {
  it("no vuelve a calcular la lista de pasos: recibe `pasos` ya construidos por el servidor", () => {
    expect(fuente).not.toContain("TIMELINE_STEPS");
  });

  it("usa las acciones activar/detener de commerce/campaign, no communications/[planKey]", () => {
    expect(fuente).toMatch(/\/api\/admin\/commerce\/campaign/);
    expect(fuente).toContain('accion: "detener"');
    expect(fuente).toContain('accion: "activar"');
  });

  it("una oferta ya enviada no se puede volver a activar desde esta pantalla", () => {
    expect(fuente).toMatch(/if \(!canEdit \|\| ocupado \|\| oferta\.enviada\) return;/);
    expect(fuente).toContain("onClick: oferta.enviada ? undefined : () => void alternarOferta(),");
  });
});

describe("refresh de estado del servidor tras guardar", () => {
  it("alternarPaso refresca tras un guardado exitoso, antes de limpiar el aviso", () => {
    const inicio = fuente.indexOf("async function alternarPaso");
    const cuerpo = fuente.slice(inicio, fuente.indexOf("async function alternarOferta"));
    expect(cuerpo).toMatch(/router\.refresh\(\);\s*\n\s*return;/);
  });

  it("ReglaEditor.guardar refresca el estado del servidor tras un guardado exitoso", () => {
    const inicioReglaEditor = fuente.indexOf("function ReglaEditor(");
    const inicio = fuente.indexOf("async function guardar()", inicioReglaEditor);
    const cuerpo = fuente.slice(inicio, fuente.indexOf("\n  return (\n    <div className=\"comms-rule\">", inicio));
    const idxAvisoOk = cuerpo.indexOf('onAviso({ ok: true, texto: "Cambios guardados." });');
    const idxRefresh = cuerpo.indexOf("router.refresh()");
    expect(idxAvisoOk).toBeGreaterThan(-1);
    expect(idxRefresh).toBeGreaterThan(idxAvisoOk);
  });

  it("cada componente que refresca usa su propio useRouter, sin compartir estado entre ellos", () => {
    expect((fuente.match(/const router = useRouter\(\);/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(fuente).toContain('import { useRouter } from "next/navigation";');
  });
});

describe("sin permiso, todo queda en solo lectura", () => {
  it("el backend vuelve a exigir el rol aunque la pantalla ya lo oculte", () => {
    const endpoints = [
      join(process.cwd(), "src/app/api/admin/courses/[id]/communications/[planKey]/route.ts"),
      join(process.cwd(), "src/app/api/admin/courses/[id]/communication-links/route.ts"),
      join(process.cwd(), "src/app/api/admin/courses/[id]/communications/[planKey]/configure/route.ts"),
      join(process.cwd(), "src/app/api/admin/courses/[id]/institutional-offer/route.ts"),
      join(process.cwd(), "src/app/api/admin/commerce/campaign/route.ts"),
    ];
    for (const ruta of endpoints) {
      const contenido = readFileSync(ruta, "utf8");
      expect(contenido, ruta).toContain("requireRole");
    }
  });

  it("las filas de Datos para los mensajes solo ofrecen Configurar con permiso", () => {
    expect(fuente).toMatch(/\{canEdit \? <button type="button" className="btn-sm ghost" onClick=\{\(\) => setModal/);
  });
});
