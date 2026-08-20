import { describe, expect, it } from "vitest";
import { extraerCampos, parsearFechas, parsearHorario, proponerCalendario } from "./course-schedule-parser";

/** Formatea en Ecuador para comprobar lo que verá una persona, no el UTC. */
const ec = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Guayaquil" });
const AHORA = new Date("2026-08-07T18:00:00.000Z");

function ficha(inicio: string, horario?: string) {
  return `<div class="dato"><span class="dato__textos"><span class="dato__etiqueta">Inicio</span><span class="dato__valor">${inicio}</span></span></div>`
    + (horario ? `<div class="dato"><span class="dato__textos"><span class="dato__etiqueta">Horario</span><span class="dato__valor">${horario}</span></span></div>` : "");
}

describe("lectura de la ficha pública", () => {
  it("extrae los pares etiqueta/valor con etiquetas en minúscula", () => {
    expect(extraerCampos(ficha("11, 12, y 13 de Agosto", "Martes 7:30-9:00 pm"))).toEqual({
      inicio: "11, 12, y 13 de Agosto",
      horario: "Martes 7:30-9:00 pm",
    });
  });

  it("limpia entidades y etiquetas anidadas", () => {
    const html = '<span class="dato__etiqueta">Inicio</span> <span class="dato__valor"><b>17,</b>&nbsp;18 y 19 de agosto</span>';
    expect(extraerCampos(html).inicio).toBe("17, 18 y 19 de agosto");
  });
});

describe("fechas", () => {
  it("lee los tres formatos reales que publica el sitio", () => {
    // Los tres separadores que aparecen hoy en ra-training.com.
    expect(parsearFechas("11, 12, y 13 de Agosto", AHORA)).toMatchObject({ days: [11, 12, 13], month: 7 });
    expect(parsearFechas("17, 18 y 19 de agosto", AHORA)).toMatchObject({ days: [17, 18, 19], month: 7 });
    expect(parsearFechas("25, 26 y 27 de Agosto", AHORA)).toMatchObject({ days: [25, 26, 27], month: 7 });
  });

  it("acepta una sola fecha", () => {
    expect(parsearFechas("14 de septiembre", AHORA)).toMatchObject({ days: [14], month: 8 });
  });

  it("deduce el año sin inventarlo: lo cercano es de este año", () => {
    expect(parsearFechas("11 de agosto", AHORA)?.year).toBe(2026);
  });

  it("un mes ya muy pasado pertenece al año siguiente", () => {
    // En agosto de 2026, "10 de enero" solo puede ser enero de 2027.
    expect(parsearFechas("10 de enero", AHORA)?.year).toBe(2027);
  });

  it("un año explícito manda sobre la deducción", () => {
    expect(parsearFechas("3 de marzo de 2028", AHORA)?.year).toBe(2028);
  });

  it("no inventa fechas cuando la página dice que no las hay", () => {
    for (const texto of ["Próximamente-Inscripciones abiertas", "Reserva tu cupo y sé de los primeros en acceder al curso.", ""]) {
      expect(parsearFechas(texto, AHORA)).toBeNull();
    }
  });

  it("descarta números que no pueden ser días", () => {
    expect(parsearFechas("45 de agosto", AHORA)).toBeNull();
  });
});

describe("horario", () => {
  it("aplica el sufijo pm a las dos horas del rango", () => {
    expect(parsearHorario("Martes, Miércoles, Jueves  7:30-9:00 pm")).toEqual({ start: { hour: 19, minute: 30 }, end: { hour: 21, minute: 0 } });
    expect(parsearHorario("Lunes, Martes y Miércoles  7:00-9:00 pm")).toEqual({ start: { hour: 19, minute: 0 }, end: { hour: 21, minute: 0 } });
  });

  it("respeta la mañana", () => {
    expect(parsearHorario("Sábados 9:00-11:00 am")).toEqual({ start: { hour: 9, minute: 0 }, end: { hour: 11, minute: 0 } });
  });

  it("no adivina cuando falta am/pm: doce horas de diferencia no se suponen", () => {
    expect(parsearHorario("Martes 7:30-9:00")).toBeNull();
  });

  it("acepta formato de 24 horas sin sufijo", () => {
    expect(parsearHorario("Martes 19:30-21:00")).toEqual({ start: { hour: 19, minute: 30 }, end: { hour: 21, minute: 0 } });
  });

  it("sin ninguna hora devuelve null", () => {
    expect(parsearHorario("Martes y jueves")).toBeNull();
  });
});

describe("propuesta completa", () => {
  it("convierte la ficha real en tres sesiones en hora de Ecuador", () => {
    const resultado = proponerCalendario(ficha("11, 12, y 13 de Agosto", "Martes, Miércoles, Jueves  7:30-9:00 pm"), AHORA);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.sessions).toHaveLength(3);
    expect(ec.format(new Date(resultado.sessions[0].startAt))).toMatch(/11 ago.*2026/);
    expect(ec.format(new Date(resultado.sessions[0].startAt))).toMatch(/7:30/);
    expect(ec.format(new Date(resultado.sessions[2].startAt))).toMatch(/13 ago.*2026/);
    expect(ec.format(new Date(resultado.sessions[0].endAt as string))).toMatch(/9:00/);
  });

  it("explica por qué no puede proponer, en lugar de fallar en silencio", () => {
    const sinFecha = proponerCalendario(ficha("Próximamente-Inscripciones abiertas"), AHORA);
    expect(sinFecha.ok).toBe(false);
    if (sinFecha.ok) return;
    expect(sinFecha.motivo).toContain("todavía no anuncia fechas");
    expect(sinFecha.fuenteInicio).toBe("Próximamente-Inscripciones abiertas");
  });

  it("con fechas pero sin horario legible no propone nada a medias", () => {
    const resultado = proponerCalendario(ficha("11, 12 y 13 de Agosto", "Martes 7:30-9:00"), AHORA);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("mañana o tarde");
  });

  it("una página sin el bloque de datos se reporta como tal", () => {
    const resultado = proponerCalendario("<html><body>Sin ficha</body></html>", AHORA);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("no publica el campo");
  });
});

/**
 * Sección M del release de estabilización (2026-08-19).
 *
 * HTML capturado en vivo de ra-training.com contra tres cursos reales
 * distintos, no inventado: el diseño `dato__etiqueta`/`dato__valor` legacy ya
 * no existe en ningún curso publicado. El nuevo bloque es `tk-dates` con un
 * `<h3>` como etiqueta. En ese momento ningún curso real disponible tenía
 * fecha publicada todavía (todos mostraban "Próximamente").
 */
const FICHA_ACTUAL_PROXIMAMENTE = `<div class="tk-line"></div>
					<div class="tk-dates">
						<div class="dt-head"><span class="ic"><svg viewBox="0 0 24 24"></svg></span><h3>INICIO DEL CURSO</h3></div>
						<div class="dt-card">
							<div class="dt-days">
								<div class="dt-day"><b style="font-size:17px;font-family:'Poppins',sans-serif">Próximamente</b></div>						</div>

						</div>
					</div>
					<div class="tk-cta">
						<span class="tk-cta-tag">Tu próximo paso</span>
						<h3 class="tk-cta-h">Empieza hoy</h3>
					</div>`;

describe("diseño actual del sitio, sin fecha anunciada (tk-dates / Próximamente)", () => {
  it("lee «Próximamente» del HTML real capturado en vivo, con la etiqueta correcta", () => {
    expect(extraerCampos(FICHA_ACTUAL_PROXIMAMENTE)).toEqual({ inicio: "Próximamente" });
  });

  it("proponerCalendario sobre el HTML real actual explica que no hay fecha, sin fallar en silencio", () => {
    const resultado = proponerCalendario(FICHA_ACTUAL_PROXIMAMENTE, AHORA);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("todavía no anuncia fechas");
    expect(resultado.fuenteInicio).toBe("Próximamente");
  });

  it("sin fecha anunciada no hay bloque de horario que leer: no se inventa una hora", () => {
    expect(extraerCampos(FICHA_ACTUAL_PROXIMAMENTE).horario).toBeUndefined();
  });

  it("el diseño legacy manda si ambos aparecen en la misma página (transición gradual del sitio)", () => {
    const mixto = ficha("20 de agosto", "Martes 7:30-9:00 pm") + FICHA_ACTUAL_PROXIMAMENTE;
    expect(extraerCampos(mixto).inicio).toBe("20 de agosto");
  });

  it("un bloque tk-dates que nunca cierra no arrastra el resto de la página", () => {
    const incompleto = '<div class="tk-dates"><div class="dt-head"><h3>INICIO DEL CURSO</h3></div><div class="dt-card">roto';
    expect(extraerCampos(incompleto).inicio).toBeUndefined();
  });
});

/**
 * Cierre de producción (2026-08-20): la fecha del curso real
 * "IA para la Planificación Educativa" cambió en el sitio de 18/19/20 a
 * 26/27/28 de agosto bajo este mismo diseño, y el parser seguía sin poder
 * leerla (ni el día, porque exigía "de" entre número y mes; ni la hora,
 * porque nunca miraba `.dt-time`). HTML capturado en vivo contra
 * https://ra-training.com/cursos/ia-para-la-planificacion-educativa/,
 * recortado a lo estructuralmente relevante (SVGs vaciados, imagen y enlace
 * de WhatsApp del asesor quitados) pero con las mismas clases y el mismo
 * texto real. A diferencia de FICHA_ACTUAL_PROXIMAMENTE, el hermano que
 * cierra tk-dates aquí es tk-cupon, no tk-cta: la prueba concreta de que ese
 * hermano varía y no puede ser el ancla del bloque.
 */
const FICHA_ACTUAL_CON_FECHA = `<div class="tk-line"></div>
<div class="tk-dates">
<div class="dt-head"><span class="ic"><svg viewBox="0 0 24 24"></svg></span><h3>INICIO DEL CURSO</h3></div>
<div class="dt-card">
<div class="dt-days">
<div class="dt-day"><small>MIÉ</small><b>26</b></div><span class="dt-dot"></span><div class="dt-day"><small>JUE</small><b>27</b></div><span class="dt-dot"></span><div class="dt-day"><small>VIE</small><b>28</b></div>
</div>
<span class="dt-mes">AGOSTO</span>
</div>
<div class="dt-time"><span class="ic"><svg viewBox="0 0 24 24"></svg></span>7:00 pm-9:00 pm</div>
</div>
<div class="tk-line"></div>
<div class="tk-cupon">
<span class="tk-cupon-lbl">Cupón de descuento</span>
<div class="ra-cupon">
<div class="rc-precios">
<span class="rc-col"><span class="rc-lbl rc-lbl--antes">ANTES</span><span class="rc-antes">$30</span></span>
<span class="rc-col"><span class="rc-lbl rc-lbl--ahora">AHORA</span><span class="rc-ahora">$15<span class="rc-usd">USD</span></span></span>
</div>
<a class="rc-btn" href="#">Inscribirme</a>
</div>
</div>`;

/**
 * Segundo curso real ("IA para la Planificación de Recursos Educativos",
 * capturado el mismo día): mismo diseño, pero el horario está escrito
 * distinto — "PM" en mayúsculas, guion largo con espacios en vez de guion
 * simple, y espacio doble antes de la hora. Prueba que la lectura no depende
 * de un formato exacto de horario, solo del diseño de clases.
 */
const FICHA_ACTUAL_OTRO_FORMATO_HORA = `<div class="tk-dates">
<div class="dt-head"><h3>INICIO DEL CURSO</h3></div>
<div class="dt-card">
<div class="dt-days">
<div class="dt-day"><small>MAR</small><b>1</b></div><div class="dt-day"><small>MIÉ</small><b>2</b></div>
</div>
<span class="dt-mes">AGOSTO</span>
</div>
<div class="dt-time">  7:00 PM – 9:00 PM</div>
</div>
<div class="tk-cupon"></div>`;

describe("diseño actual del sitio, con fecha anunciada (tk-dates / dt-day / dt-mes / dt-time)", () => {
  it("lee los tres días, el mes y el horario reales por clase, no por texto libre", () => {
    expect(extraerCampos(FICHA_ACTUAL_CON_FECHA)).toEqual({
      inicio: "26, 27, 28 de AGOSTO",
      horario: "7:00 pm-9:00 pm",
    });
  });

  it("el bloque cierra contra tk-cupon (no tk-cta) y aun así se aísla correctamente", () => {
    // Justo el caso que rompía el delimitador fijo anterior: aquí no hay
    // ningún "tk-cta" en todo el documento.
    expect(FICHA_ACTUAL_CON_FECHA).not.toContain("tk-cta");
    expect(extraerCampos(FICHA_ACTUAL_CON_FECHA).inicio).toBe("26, 27, 28 de AGOSTO");
  });

  it("parsearFechas entiende el texto recompuesto sin necesitar cambios propios", () => {
    expect(parsearFechas(extraerCampos(FICHA_ACTUAL_CON_FECHA).inicio ?? "", AHORA)).toMatchObject({
      days: [26, 27, 28],
      month: 7,
      year: 2026,
    });
  });

  it("proponerCalendario produce las tres sesiones reales, con las horas ISO exactas (Ecuador UTC-5)", () => {
    const resultado = proponerCalendario(FICHA_ACTUAL_CON_FECHA, AHORA);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.sessions).toEqual([
      { startAt: "2026-08-27T00:00:00.000Z", endAt: "2026-08-27T02:00:00.000Z" }, // 26 ago 19:00-21:00 EC
      { startAt: "2026-08-28T00:00:00.000Z", endAt: "2026-08-28T02:00:00.000Z" }, // 27 ago 19:00-21:00 EC
      { startAt: "2026-08-29T00:00:00.000Z", endAt: "2026-08-29T02:00:00.000Z" }, // 28 ago 19:00-21:00 EC
    ]);
    expect(ec.format(new Date(resultado.sessions[0].startAt))).toMatch(/26 ago.*2026/);
    expect(ec.format(new Date(resultado.sessions[0].startAt))).toMatch(/7:00/);
    expect(ec.format(new Date(resultado.sessions[2].startAt))).toMatch(/28 ago.*2026/);
  });

  it("lee un horario con mayúsculas y guion largo (segundo curso real) igual que el formato con guion simple", () => {
    expect(extraerCampos(FICHA_ACTUAL_OTRO_FORMATO_HORA)).toEqual({
      inicio: "1, 2 de AGOSTO",
      horario: "7:00 PM – 9:00 PM",
    });
    const resultado = proponerCalendario(FICHA_ACTUAL_OTRO_FORMATO_HORA, AHORA);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.sessions[0]).toEqual({ startAt: "2026-08-02T00:00:00.000Z", endAt: "2026-08-02T02:00:00.000Z" });
  });

  it("con fecha pero sin bloque de horario, falla cerrado en vez de inventar una hora", () => {
    const sinHorario = FICHA_ACTUAL_CON_FECHA.replace(/<div class="dt-time">[\s\S]*?<\/div>/, "");
    expect(extraerCampos(sinHorario).horario).toBeUndefined();
    const resultado = proponerCalendario(sinHorario, AHORA);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("no publica el horario");
  });

  it("el diseño legacy manda si ambos aparecen con fechas reales (transición gradual del sitio)", () => {
    const mixto = ficha("20 de agosto", "Martes 7:30-9:00 pm") + FICHA_ACTUAL_CON_FECHA;
    expect(extraerCampos(mixto)).toEqual({ inicio: "20 de agosto", horario: "Martes 7:30-9:00 pm" });
  });
});
