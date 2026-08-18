import { describe, expect, it } from "vitest";
import { DEFAULT_AUTOMATION_PLAN } from "./default-automations";
import { WHATSAPP_AUTOMATION_PLAN } from "./default-automations-whatsapp";
import { scheduleTargets } from "./engine";
import type { ResolvedCourseSession } from "@/lib/course-sessions";

/**
 * Calendario de los once momentos, medido contra sesiones reales.
 *
 * Todo se expresa en UTC y se compara en UTC. Las sesiones se guardan asi y
 * America/Guayaquil no tiene horario de verano, de modo que un desfase fijo en
 * minutos no puede desplazarse por un cambio de hora.
 */

/** Curso de tres sesiones: 18, 19 y 20 de agosto, de 19:30 a 21:00 en Ecuador. */
const SESIONES: ResolvedCourseSession[] = [18, 19, 20].map((dia, indice) => ({
  id: `s${dia}`,
  key: `s${dia}`,
  title: null,
  startAt: new Date(`2026-08-${dia}T00:30:00.000Z`),
  endAt: new Date(`2026-08-${dia}T02:00:00.000Z`),
  streamUrl: "https://meet.google.com/abc",
  timezone: "America/Guayaquil",
  position: indice + 1,
  totalSessions: 3,
}) as ResolvedCourseSession);

const ULTIMA_TERMINA = new Date("2026-08-20T02:00:00.000Z");
const INSCRIPCION = new Date("2026-08-10T15:00:00.000Z");
const AHORA = new Date("2026-08-10T15:00:00.000Z");

function planDe(planKey: string) {
  const entrada = DEFAULT_AUTOMATION_PLAN.find((item) => item.planKey === planKey);
  if (!entrada) throw new Error(`Falta ${planKey} en el plan`);
  return entrada;
}

function momentos(planKey: string): Date[] {
  const entrada = planDe(planKey);
  return scheduleTargets(
    { trigger: entrada.trigger, offsetMinutes: entrada.offsetMinutes, planKey: entrada.planKey },
    SESIONES,
    "enr1",
    INSCRIPCION,
    AHORA,
  ).map((objetivo) => objetivo.scheduledAt);
}

const minutosDesde = (referencia: Date, momento: Date) => Math.round((momento.getTime() - referencia.getTime()) / 60_000);

describe("los once momentos existen en los dos canales", () => {
  const ESPERADOS = [
    "welcome", "whatsapp_group", "reminder_24h", "reminder_2h", "reminder_15m",
    "session_live", "late_access", "session_complete", "course_complete", "course_follow_up", "survey",
  ];

  it("el plan de correo declara los once", () => {
    expect(DEFAULT_AUTOMATION_PLAN.map((e) => e.planKey)).toEqual(ESPERADOS);
  });

  it("el plan de WhatsApp declara los mismos once, con los mismos tiempos", () => {
    expect(WHATSAPP_AUTOMATION_PLAN.map((e) => e.planKey)).toEqual(ESPERADOS);
    for (const entrada of WHATSAPP_AUTOMATION_PLAN) {
      const correo = planDe(entrada.planKey);
      expect(entrada.trigger, entrada.planKey).toBe(correo.trigger);
      expect(entrada.offsetMinutes, entrada.planKey).toBe(correo.offsetMinutes);
    }
  });
});

describe("avisos por sesión", () => {
  it("los recordatorios salen una vez por sesión, medidos desde su inicio", () => {
    for (const [planKey, minutosAntes] of [["reminder_24h", 1440], ["reminder_2h", 120], ["reminder_15m", 15]] as const) {
      const salidas = momentos(planKey);
      expect(salidas, planKey).toHaveLength(3);
      salidas.forEach((momento, i) => {
        expect(minutosDesde(SESIONES[i].startAt, momento), `${planKey} sesión ${i + 1}`).toBe(-minutosAntes);
      });
    }
  });

  it("la sesión en vivo cae en la hora exacta de inicio", () => {
    momentos("session_live").forEach((momento, i) => {
      expect(momento.getTime()).toBe(SESIONES[i].startAt.getTime());
    });
  });

  it("rezagados sale 20 minutos después de empezar cada sesión", () => {
    momentos("late_access").forEach((momento, i) => {
      expect(minutosDesde(SESIONES[i].startAt, momento)).toBe(20);
    });
  });

  it("el cierre sale tras cada sesión que tenga siguiente, contado desde su final", () => {
    // `session_complete` es AFTER_COURSE y caia en el bloque de "una vez por
    // curso", asi que en un curso de tres sesiones solo habia un cierre, al
    // final. Las sesiones intermedias son justo las que deben anunciar cual es
    // la siguiente.
    //
    // Y por eso mismo la ultima queda fuera: el texto dice "continuaremos con
    // {{proxima_sesion}}" y despues de la tercera no hay nada que anunciar. El
    // cierre del curso entero lo cubren `course_complete` y `survey`.
    const salidas = momentos("session_complete");
    expect(salidas).toHaveLength(SESIONES.length - 1);
    salidas.forEach((momento, i) => {
      expect(minutosDesde(SESIONES[i].endAt as Date, momento), `sesión ${i + 1}`).toBe(5);
    });
  });
});

describe("avisos posteriores al curso: una sola vez, tras la última sesión", () => {
  it("curso completo sale 1 hora después de terminar", () => {
    const salidas = momentos("course_complete");
    expect(salidas).toHaveLength(1);
    expect(minutosDesde(ULTIMA_TERMINA, salidas[0])).toBe(60);
  });

  it("el seguimiento sale 24 horas después del mensaje de curso completo", () => {
    const completo = momentos("course_complete")[0];
    const seguimiento = momentos("course_follow_up")[0];
    expect(minutosDesde(completo, seguimiento)).toBe(1440);
  });

  it("la encuesta sale 48 horas después de terminar la última sesión", () => {
    const salidas = momentos("survey");
    expect(salidas).toHaveLength(1);
    expect(minutosDesde(ULTIMA_TERMINA, salidas[0])).toBe(2880);
  });

  it("ninguno queda a una semana ni se adelanta al fin del curso", () => {
    for (const planKey of ["course_complete", "course_follow_up", "survey"]) {
      const momento = momentos(planKey)[0];
      const horas = minutosDesde(ULTIMA_TERMINA, momento) / 60;
      expect(horas, planKey).toBeGreaterThan(0);
      expect(horas, `${planKey} no puede caer días después`).toBeLessThanOrEqual(48);
    }
  });

  it("los tres se miden desde la ÚLTIMA sesión, no desde la primera", () => {
    // El sintoma que hizo sospechar de un fallo era ver "Felicitaciones" el 27
    // de agosto con sesiones del 18 al 20. Resulto ser otro curso, pero la
    // relacion tiene que quedar fijada para poder descartarlo sin investigar.
    for (const planKey of ["course_complete", "course_follow_up", "survey"]) {
      expect(momentos(planKey)[0].getTime(), planKey).toBeGreaterThan(SESIONES[2].startAt.getTime());
    }
  });
});

describe("bienvenida y grupo", () => {
  it("la bienvenida es inmediata al inscribirse y el grupo 2 minutos después", () => {
    expect(momentos("welcome")).toHaveLength(1);
    expect(minutosDesde(INSCRIPCION, momentos("welcome")[0])).toBe(0);
    expect(minutosDesde(INSCRIPCION, momentos("whatsapp_group")[0])).toBe(2);
  });

  it("no dependen de las sesiones: salen aunque el curso aún no tenga fecha", () => {
    const entrada = planDe("welcome");
    const sinSesiones = scheduleTargets(
      { trigger: entrada.trigger, offsetMinutes: entrada.offsetMinutes, planKey: entrada.planKey },
      [],
      "enr1",
      INSCRIPCION,
      AHORA,
    );
    expect(sinSesiones).toHaveLength(1);
  });
});

describe("claves idempotentes", () => {
  it("cada sesión produce su propia clave, y los de curso una sola", () => {
    // Es lo que impide que un tick repetido cree un segundo aviso: la clave
    // incluye la sesion cuando el aviso es por sesion.
    const entrada = planDe("reminder_2h");
    const claves = scheduleTargets(
      { trigger: entrada.trigger, offsetMinutes: entrada.offsetMinutes, planKey: entrada.planKey },
      SESIONES,
      "enr1",
      INSCRIPCION,
      AHORA,
    ).map((objetivo) => objetivo.stepKey);
    expect(new Set(claves).size).toBe(3);
    for (const clave of claves) expect(clave).toContain("session:");
  });
});
