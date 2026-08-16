import { describe, expect, it } from "vitest";
import { resolverDerecho, validarCompraNueva, type CompraMinima } from "./entitlement";
import { advertenciaComercial, decidirAutomatico, decidirManual, offerSequenceKey, OFFER_STEP_KEY } from "./offer-eligibility";
import { calcularEnvioAutomatico, minutosHastaUltimoMensaje } from "./offer-schedule";
import type { ResolvedCourseSession } from "@/lib/course-sessions";

const compra = (parcial: Partial<CompraMinima> & Pick<CompraMinima, "offerType">): CompraMinima => ({
  status: "PENDING",
  ...parcial,
});

// ─── Modelo de compras y derecho ────────────────────────────────────────────

describe("derecho de acceso", () => {
  it("FULL verificada da nivel completo y acceso", () => {
    expect(resolverDerecho([compra({ offerType: "FULL", status: "PAYMENT_VERIFIED" })]))
      .toEqual({ tier: "FULL", accesoCursoCompleto: true });
  });

  it("INSTITUTIONAL verificada da nivel institucional y el mismo acceso", () => {
    // El curso de 60 horas es el mismo; lo que cambia es el certificado.
    expect(resolverDerecho([compra({ offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" })]))
      .toEqual({ tier: "INSTITUTIONAL", accesoCursoCompleto: true });
  });

  it("registrar la compra en Finance NO concede derecho: solo el pago verificado", () => {
    for (const estado of ["PENDING", "SENT_TO_FINANCE", "PAYMENT_PENDING", "ERROR", "CANCELLED"] as const) {
      expect(resolverDerecho([compra({ offerType: "FULL", status: estado })]), estado)
        .toEqual({ tier: "NONE", accesoCursoCompleto: false });
    }
  });

  it("institucional + mejora verificadas elevan a completo sin duplicar acceso", () => {
    const derecho = resolverDerecho([
      compra({ id: "p1", offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" }),
      compra({ id: "p2", offerType: "AVAL_UPGRADE", status: "PAYMENT_VERIFIED", parentPurchaseId: "p1" }),
    ]);
    expect(derecho).toEqual({ tier: "FULL", accesoCursoCompleto: true });
  });

  it("una mejora sin su institucional verificada no eleva el nivel", () => {
    const derecho = resolverDerecho([
      compra({ id: "p1", offerType: "INSTITUTIONAL", status: "PAYMENT_PENDING" }),
      compra({ id: "p2", offerType: "AVAL_UPGRADE", status: "PAYMENT_VERIFIED", parentPurchaseId: "p1" }),
    ]);
    expect(derecho.tier).toBe("NONE");
  });

  it("sin compras no hay acceso", () => {
    expect(resolverDerecho([])).toEqual({ tier: "NONE", accesoCursoCompleto: false });
  });
});

describe("qué compras pueden crearse", () => {
  const institucionalPagada = compra({ id: "p1", offerType: "INSTITUTIONAL", status: "PAYMENT_VERIFIED" });

  it("la mejora exige indicar su compra institucional", () => {
    expect(validarCompraNueva({ offerType: "AVAL_UPGRADE" }, [institucionalPagada])?.codigo).toBe("UPGRADE_SIN_PADRE");
  });

  it("la mejora exige que esa compra ya esté pagada", () => {
    const pendiente = compra({ id: "p1", offerType: "INSTITUTIONAL", status: "PAYMENT_PENDING" });
    expect(validarCompraNueva({ offerType: "AVAL_UPGRADE", parentPurchaseId: "p1" }, [pendiente])?.codigo)
      .toBe("UPGRADE_PADRE_SIN_PAGO");
  });

  it("acepta la mejora sobre una institucional verificada", () => {
    expect(validarCompraNueva({ offerType: "AVAL_UPGRADE", parentPurchaseId: "p1" }, [institucionalPagada])).toBeNull();
  });

  it("no permite dos mejoras", () => {
    const conMejora = [institucionalPagada, compra({ id: "p2", offerType: "AVAL_UPGRADE", parentPurchaseId: "p1" })];
    expect(validarCompraNueva({ offerType: "AVAL_UPGRADE", parentPurchaseId: "p1" }, conMejora)?.codigo).toBe("UPGRADE_DUPLICADO");
  });

  it("no permite comprar FULL e INSTITUTIONAL a la vez", () => {
    // Serian dos pagos por el mismo acceso de 60 horas.
    expect(validarCompraNueva({ offerType: "FULL" }, [institucionalPagada])?.codigo).toBe("MODALIDAD_INCOMPATIBLE");
  });

  it("una compra cancelada no bloquea volver a comprar", () => {
    const cancelada = [compra({ id: "p1", offerType: "INSTITUTIONAL", status: "CANCELLED" })];
    expect(validarCompraNueva({ offerType: "INSTITUTIONAL" }, cancelada)).toBeNull();
  });
});

// ─── Campaña: modo histórico ────────────────────────────────────────────────

describe("modo histórico: decide la persona, no los datos heredados", () => {
  it("permite seleccionar aunque Finance no sepa clasificar", () => {
    // Es el caso real de los cursos previos: no existe CRMCompras.
    expect(decidirManual({}, "HISTORICAL_MANUAL", "LEGACY_UNCLASSIFIED").elegible).toBe(true);
  });

  it("permite seleccionar sin ninguna información de Finance", () => {
    expect(decidirManual({}, "HISTORICAL_MANUAL", null).elegible).toBe(true);
  });

  it("permite seleccionar aunque Finance diga que ya compró", () => {
    // En datos historicos ese estado no es fiable; manda la lista real del
    // administrador. Se advierte, pero no se bloquea.
    expect(decidirManual({}, "HISTORICAL_MANUAL", "FULL_VERIFIED").elegible).toBe(true);
    expect(advertenciaComercial("FULL_VERIFIED")).toContain("ya compró");
  });

  it("la exclusión manual gana siempre, también en histórico", () => {
    const excluido = { manualExcludedAt: new Date() };
    expect(decidirManual(excluido, "HISTORICAL_MANUAL", null).estado).toBe("EXCLUDED");
    expect(decidirAutomatico(excluido, "NO_PURCHASE").estado).toBe("EXCLUDED");
  });

  it("un histórico NUNCA es elegible por la vía automática", () => {
    // El cron solo procesa AUTOMATIC_COMMERCE; ademas, sin dato de Finance la
    // decision automatica falla cerrada.
    expect(decidirAutomatico({}, null).elegible).toBe(false);
    expect(decidirAutomatico({}, "LEGACY_UNCLASSIFIED").estado).toBe("REQUIRES_REVIEW");
  });
});

// ─── Campaña: modo automático ───────────────────────────────────────────────

describe("modo automático: decide Finance", () => {
  it("solo envía a quien no tiene ninguna compra", () => {
    expect(decidirAutomatico({}, "NO_PURCHASE")).toMatchObject({ elegible: true, estado: "ELIGIBLE" });
  });

  it("no envía a quien ya compró, ni con el pago pendiente", () => {
    const conCompra = ["FULL_PENDING", "FULL_VERIFIED", "INSTITUTIONAL_PENDING", "INSTITUTIONAL_VERIFIED", "UPGRADE_PENDING", "FULL_UPGRADED"] as const;
    for (const estado of conCompra) {
      expect(decidirAutomatico({}, estado).elegible, estado).toBe(false);
    }
    expect(decidirAutomatico({}, "FULL_PENDING").estado).toBe("NOT_ELIGIBLE_PENDING_PAYMENT");
    expect(decidirAutomatico({}, "FULL_VERIFIED").estado).toBe("NOT_ELIGIBLE_PURCHASED");
  });

  it("una compra cancelada no se trata como compra válida ni como ausencia de compra", () => {
    expect(decidirAutomatico({}, "CANCELLED")).toMatchObject({ elegible: false, estado: "REQUIRES_REVIEW" });
  });

  it("si Finance no responde, no se envía", () => {
    // Fail closed: ofrecer un pago a quien ya pago es caro y visible; no
    // enviarlo se corrige con un clic.
    expect(decidirAutomatico({}, null)).toMatchObject({ elegible: false, estado: "ERROR" });
  });

  it("quien ya recibió el manual no recibe el automático", () => {
    expect(decidirAutomatico({ manualSentAt: new Date() }, "NO_PURCHASE").estado).toBe("SENT");
  });

  it("quien ya recibió el automático no recibe el manual", () => {
    expect(decidirManual({ automaticSentAt: new Date() }, "AUTOMATIC_COMMERCE", "NO_PURCHASE").estado).toBe("SENT");
  });

  it("en cursos nuevos el manual sí respeta la compra registrada", () => {
    expect(decidirManual({}, "AUTOMATIC_COMMERCE", "FULL_VERIFIED").elegible).toBe(false);
  });
});

// ─── Momento del envío automático ───────────────────────────────────────────

describe("cuándo sale el envío automático", () => {
  const SESIONES = [1, 2, 3].map((dia) => ({
    id: `s${dia}`, key: `s${dia}`, title: null,
    startAt: new Date(`2026-09-0${dia}T00:30:00.000Z`),
    endAt: new Date(`2026-09-0${dia}T02:00:00.000Z`),
    streamUrl: null, timezone: "America/Guayaquil", position: dia, totalSessions: 3,
  }) as ResolvedCourseSession);
  const FIN = new Date("2026-09-03T02:00:00.000Z");

  it("se mide desde el último de los once mensajes, no desde una constante", () => {
    // El ultimo es la encuesta, a 48 h del fin del curso.
    expect(minutosHastaUltimoMensaje()).toBe(2880);
  });

  const horasTrasFin = (momento: Date | null) => {
    if (!momento) throw new Error("Se esperaba un momento programado");
    return (momento.getTime() - FIN.getTime()) / 3_600_000;
  };

  it("sale 24 horas después del último mensaje, por defecto", () => {
    expect(horasTrasFin(calcularEnvioAutomatico(SESIONES, 24))).toBe(48 + 24);
  });

  it("el retraso es configurable, no fijo", () => {
    expect(horasTrasFin(calcularEnvioAutomatico(SESIONES, 6))).toBe(48 + 6);
  });

  it("sin sesiones no se programa nada, en vez de inventar una fecha", () => {
    expect(calcularEnvioAutomatico([], 24)).toBeNull();
  });

  it("un retraso inválido cae en 24 horas en lugar de romper el cálculo", () => {
    expect(calcularEnvioAutomatico(SESIONES, Number.NaN)?.getTime())
      .toBe(calcularEnvioAutomatico(SESIONES, 24)?.getTime());
  });
});

describe("identidad compartida entre manual y automático", () => {
  it("los dos usan la misma clave, así que no pueden duplicar el mensaje", () => {
    // La unicidad de OutboundMessage es (lead, enrollment, sequenceKey, stepKey):
    // con la misma clave, el segundo intento choca en vez de crear otra fila.
    expect(offerSequenceKey("curso-1")).toBe("certification-offer:curso-1");
    expect(OFFER_STEP_KEY).toBe("institutional-offer");
  });

  it("cursos distintos no comparten identidad", () => {
    expect(offerSequenceKey("curso-1")).not.toBe(offerSequenceKey("curso-2"));
  });
});
