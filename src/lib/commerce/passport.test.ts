import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calcularPasaporte, courseCountsTowardPassport, META_PASAPORTE } from "./passport";

/**
 * Pasaporte de cinco cursos.
 *
 * El riesgo va en una sola direccion: contar de mas regala un certificado que
 * nadie pago, y eso no se detecta hasta que alguien lo reclama. Por eso solo
 * suma un pago verificado de una compra BASE.
 */
const VERIFICADA = { offerType: "FULL" as const, status: "PAYMENT_VERIFIED" as const };
const INSTITUCIONAL = { offerType: "INSTITUTIONAL" as const, status: "PAYMENT_VERIFIED" as const };
const MEJORA = { offerType: "AVAL_UPGRADE" as const, status: "PAYMENT_VERIFIED" as const };

function inscripcion(id: string, courseId: string, purchases: Array<{ offerType: "FULL" | "INSTITUTIONAL" | "AVAL_UPGRADE"; status: string }>, isFree = false) {
  return { enrollmentId: id, courseId, courseTitle: `Curso ${courseId}`, isFree, purchases: purchases as never };
}

describe("qué cuenta", () => {
  it("sin compras no cuenta", () => {
    expect(courseCountsTowardPassport([])).toBe(false);
  });

  it("asistir gratis no cuenta", () => {
    const r = calcularPasaporte([inscripcion("e1", "c1", [], true)]);
    expect(r.contabilizados).toBe(0);
    expect(r.lineas[0].etiqueta).toContain("Actividad gratuita");
  });

  it("una compra registrada pero sin cobrar no cuenta", () => {
    for (const status of ["PENDING", "SENT_TO_FINANCE", "PAYMENT_PENDING", "ERROR"]) {
      expect(courseCountsTowardPassport([{ offerType: "FULL", status } as never]), status).toBe(false);
    }
  });

  it("una compra cancelada no cuenta", () => {
    expect(courseCountsTowardPassport([{ offerType: "FULL", status: "CANCELLED" } as never])).toBe(false);
  });

  it("institucional verificada cuenta", () => {
    expect(courseCountsTowardPassport([INSTITUCIONAL])).toBe(true);
  });

  it("completa verificada cuenta", () => {
    expect(courseCountsTowardPassport([VERIFICADA])).toBe(true);
  });

  it("la mejora con aval NO cuenta por sí sola: no es otro curso", () => {
    expect(courseCountsTowardPassport([MEJORA])).toBe(false);
  });
});

describe("una persona y un curso suman como máximo uno", () => {
  it("institucional + mejora del mismo curso cuentan 1", () => {
    const r = calcularPasaporte([inscripcion("e1", "c1", [INSTITUCIONAL, MEJORA])]);
    expect(r.contabilizados).toBe(1);
  });

  it("dos compras completas del mismo curso cuentan 1", () => {
    const r = calcularPasaporte([inscripcion("e1", "c1", [VERIFICADA, VERIFICADA])]);
    expect(r.contabilizados).toBe(1);
  });

  it("dos inscripciones al MISMO curso cuentan 1", () => {
    const r = calcularPasaporte([inscripcion("e1", "c1", [VERIFICADA]), inscripcion("e2", "c1", [VERIFICADA])]);
    expect(r.contabilizados).toBe(1);
  });

  it("cinco cursos distintos pagados completan el pasaporte", () => {
    const r = calcularPasaporte(["c1", "c2", "c3", "c4", "c5"].map((c, i) => inscripcion(`e${i}`, c, [VERIFICADA])));
    expect(r.contabilizados).toBe(5);
    expect(r.meta).toBe(META_PASAPORTE);
  });

  it("tres pagados y dos pendientes dan 3", () => {
    const r = calcularPasaporte([
      inscripcion("e1", "c1", [VERIFICADA]),
      inscripcion("e2", "c2", [INSTITUCIONAL]),
      inscripcion("e3", "c3", [VERIFICADA]),
      inscripcion("e4", "c4", [{ offerType: "FULL", status: "PAYMENT_PENDING" }]),
      inscripcion("e5", "c5", []),
    ]);
    expect(r.contabilizados).toBe(3);
    expect(r.lineas.filter((l) => l.cuenta)).toHaveLength(3);
    expect(r.lineas[3].etiqueta).toContain("pago pendiente");
  });
});

describe("el importe no decide nada", () => {
  it("el módulo no mira cantidades", () => {
    const fuente = readFileSync(join(process.cwd(), "src/lib/commerce/passport.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(fuente).not.toMatch(/\bamount\b|\bprice\b|=== 10|=== 20/);
  });

  it("la modalidad la dice offerType y el cobro lo dice el estado", () => {
    const fuente = readFileSync(join(process.cwd(), "src/lib/commerce/passport.ts"), "utf8");
    expect(fuente).toContain("ESTADO_PAGO_VERIFICADO");
    expect(fuente).toContain('new Set(["FULL", "INSTITUTIONAL"])');
  });
});

describe("no redefine nada existente", () => {
  it("no usa Enrollment.status como fuente de verdad", () => {
    // Ese estado describe el recorrido operativo del curso; redefinirlo
    // cambiaria el significado de datos que ya existen.
    // Sin comentarios: el modulo nombra ese estado justo para explicar que NO
    // lo usa, y buscarlo en el archivo entero encontraria la explicacion.
    const codigo = readFileSync(join(process.cwd(), "src/lib/commerce/passport.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codigo).not.toContain("COMPLETADO");
    // El estado que si se mira es el de la COMPRA, no el de la inscripcion.
    expect(codigo).toContain("compra.status === ESTADO_PAGO_VERIFICADO");
  });

  it("es derivado: no hay columna ni backfill", () => {
    const fuente = readFileSync(join(process.cwd(), "src/lib/commerce/passport.ts"), "utf8");
    expect(fuente).not.toContain("prisma.");
  });

  it("no habla de aprobación académica", () => {
    const fuente = readFileSync(join(process.cwd(), "src/lib/commerce/passport.ts"), "utf8");
    expect(fuente).toContain("Curso contabilizado · pago verificado");
    expect(fuente).not.toMatch(/aprobad|Moodle|calificaci/i);
  });
});
