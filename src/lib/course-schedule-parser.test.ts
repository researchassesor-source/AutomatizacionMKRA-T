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
