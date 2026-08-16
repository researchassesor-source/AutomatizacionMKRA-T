import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato comercial con Finance.
 *
 * Ninguna prueba llama a Finance de verdad: `authedCall` esta simulado. Lo que
 * se comprueba es que un cuerpo que no cumple el contrato se rechaza en vez de
 * usarse, porque de ese dato depende si alguien recibe una oferta de pago.
 */
import { esPagoVerificado } from "@/lib/commerce/purchases";

const llamada = vi.fn();
vi.mock("./client", () => ({ authedCall: (...args: unknown[]) => llamada(...args) }));

const { getCrmEnrollmentCommerceStates, getCrmPurchaseStatuses, importCrmPurchase, markCrmCourseCompleted, enLotes, MAX_COMMERCE_BATCH } =
  await import("./commerce");

const ESTADO_VALIDO = {
  crmEnrollmentId: "enr1",
  financeInscripcionId: "INS-1",
  commercialState: "NO_PURCHASE",
  effectiveEntitlement: "NONE",
  purchases: [],
  requiresExternalAval: false,
  avalStatus: null,
  completionStatus: null,
  completedAt: null,
};

beforeEach(() => llamada.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("consulta por lote del estado comercial", () => {
  it("devuelve un mapa indexado por inscripción", async () => {
    llamada.mockResolvedValue({ success: true, data: [ESTADO_VALIDO, { ...ESTADO_VALIDO, crmEnrollmentId: "enr2", commercialState: "FULL_VERIFIED", effectiveEntitlement: "FULL" }] });
    const resultado = await getCrmEnrollmentCommerceStates(["enr1", "enr2"]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.datos.get("enr2")?.commercialState).toBe("FULL_VERIFIED");
  });

  it("respeta el tope de 100 que impone Finance", async () => {
    const muchos = Array.from({ length: MAX_COMMERCE_BATCH + 1 }, (_, i) => `enr${i}`);
    const resultado = await getCrmEnrollmentCommerceStates(muchos);
    expect(resultado).toMatchObject({ ok: false });
    // No debe ni intentar la llamada: Finance la rechazaria igualmente.
    expect(llamada).not.toHaveBeenCalled();
  });

  it("una lista vacía no llama a Finance", async () => {
    await getCrmEnrollmentCommerceStates([]);
    expect(llamada).not.toHaveBeenCalled();
  });

  it("rechaza un estado comercial que no está en el contrato", async () => {
    // Aceptarlo significaria decidir sobre pagos con un valor que no
    // entendemos, y eso acaba en una oferta enviada a quien ya pago.
    llamada.mockResolvedValue({ success: true, data: [{ ...ESTADO_VALIDO, commercialState: "INVENTADO" }] });
    expect(await getCrmEnrollmentCommerceStates(["enr1"])).toMatchObject({ ok: false });
  });

  it("propaga el error de Finance sin inventar datos", async () => {
    llamada.mockResolvedValue({ success: false, error: "token vencido" });
    const resultado = await getCrmEnrollmentCommerceStates(["enr1"]);
    expect(resultado).toMatchObject({ ok: false, error: "token vencido" });
  });

  it("acepta compras encadenadas con su padre", async () => {
    llamada.mockResolvedValue({
      success: true,
      data: [{
        ...ESTADO_VALIDO,
        commercialState: "FULL_UPGRADED",
        effectiveEntitlement: "FULL",
        purchases: [
          { crmOrderId: "o1", offerType: "INSTITUTIONAL", amount: 10, paymentStatus: "VERIFICADO", paymentVerifiedAt: "2026-09-01T10:00:00Z" },
          { crmOrderId: "o2", offerType: "AVAL_UPGRADE", parentCrmOrderId: "o1", amount: 10, paymentStatus: "VERIFICADO" },
        ],
      }],
    });
    const resultado = await getCrmEnrollmentCommerceStates(["enr1"]);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.datos.get("enr1")?.purchases).toHaveLength(2);
  });
});

describe("registro de compras", () => {
  it("registrar en Finance NO afirma que el pago esté verificado", async () => {
    // Finance devuelve el estado del pago en la propia alta, y en una compra
    // recien creada llega como PAYMENT_PENDING. Se parsea —forma parte del
    // contrato— pero no concede nada: quien decide es `esPagoVerificado`.
    llamada.mockResolvedValue({ success: true, data: { financeInscripcionId: "INS-9", paymentStatus: "PAYMENT_PENDING" } });
    const resultado = await importCrmPurchase({
      crmOrderId: "o1", crmEnrollmentId: "enr1", crmContactId: "c1", crmCourseId: "cur1",
      courseTitle: "Curso", modality: null, startDate: null, endDate: null,
      participant: { fullName: "Ana", firstName: "Ana", lastName: null, email: "a@b.com", phone: null, identification: null },
      offerType: "INSTITUTIONAL", amount: 10,
    });
    expect(resultado).toMatchObject({ ok: true, datos: { financeInscripcionId: "INS-9", paymentStatus: "PAYMENT_PENDING" } });
    // Lo que importa: el estado devuelto no es el que concede derecho.
    expect(esPagoVerificado(resultado.ok ? resultado.datos.paymentStatus : null)).toBe(false);
  });

  it("el estado de pago se consulta aparte y por lote", async () => {
    llamada.mockResolvedValue({ success: true, data: [{ crmOrderId: "o1", paymentStatus: "VERIFICADO", paymentVerifiedAt: "2026-09-01T10:00:00Z" }] });
    const resultado = await getCrmPurchaseStatuses(["o1"]);
    expect(resultado.ok).toBe(true);
  });
});

describe("aviso de finalización", () => {
  it("confirma cuando Finance acepta", async () => {
    llamada.mockResolvedValue({ success: true });
    expect(await markCrmCourseCompleted({ crmEnrollmentId: "enr1", completionStatus: "completado", source: "MOODLE" }))
      .toMatchObject({ ok: true, datos: { registrado: true } });
  });

  it("no da por registrado un fallo de Finance", async () => {
    llamada.mockResolvedValue({ success: false, error: "hoja bloqueada" });
    expect(await markCrmCourseCompleted({ crmEnrollmentId: "enr1", completionStatus: "completado", source: "MOODLE" }))
      .toMatchObject({ ok: false });
  });
});

describe("no se filtran secretos", () => {
  it("los parámetros enviados no incluyen credenciales", async () => {
    llamada.mockResolvedValue({ success: true, data: [] });
    await getCrmPurchaseStatuses(["o1"]);
    const [, params] = llamada.mock.calls[0];
    expect(JSON.stringify(params)).not.toMatch(/token|password|secret/i);
  });
});

describe("troceado por lotes", () => {
  it("divide en bloques del tamaño que admite Finance", () => {
    const lotes = enLotes(Array.from({ length: 250 }, (_, i) => i));
    expect(lotes.map((l) => l.length)).toEqual([100, 100, 50]);
  });
});
