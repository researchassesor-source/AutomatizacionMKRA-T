// biome-ignore-all lint/suspicious/noExplicitAny: El doble de Prisma usa objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelIrreversibleMessages, quarantineRecoverableMessages } from "./queue-safety";

function dbFalso() {
  return { outboundMessage: { updateMany: vi.fn(async () => ({ count: 3 })) } } as any;
}

const MOTIVO = { errorCode: "CODIGO_DE_PRUEBA", errorMessage: "Motivo de prueba." };

/**
 * Vocabulario central de la cola: reversible -> OMITIDO, irreversible ->
 * CANCELADO. La garantía que importa aquí es que ninguna de las dos toque
 * jamás un estado histórico (ya enviado, entregado, leído, etc.) y que cada
 * una trabaje sobre exactamente el subconjunto de estados que le corresponde.
 */
describe("quarantineRecoverableMessages", () => {
  let db: ReturnType<typeof dbFalso>;
  beforeEach(() => { db = dbFalso(); });

  it("solo toca PROGRAMADO y FALLIDO: nunca un estado histórico", async () => {
    await quarantineRecoverableMessages(db, { automationRuleId: "regla-1" }, MOTIVO);
    const { where } = db.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.status.in.sort()).toEqual(["FALLIDO", "PROGRAMADO"]);
    for (const historico of ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO", "SIMULADO", "REBOTADO", "ENVIANDO", "CANCELADO"]) {
      expect(where.status.in).not.toContain(historico);
    }
  });

  it("conserva el resto del filtro que le pasan, AND-eado con el estado", async () => {
    await quarantineRecoverableMessages(db, { automationRuleId: "regla-1", courseSessionId: "sesion-1" }, MOTIVO);
    const { where } = db.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.automationRuleId).toBe("regla-1");
    expect(where.courseSessionId).toBe("sesion-1");
  });

  it("pone OMITIDO, limpia nextAttemptAt y guarda el motivo en los tres campos de error", async () => {
    await quarantineRecoverableMessages(db, {}, MOTIVO);
    const { data } = db.outboundMessage.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({
      status: "OMITIDO",
      errorCode: "CODIGO_DE_PRUEBA",
      errorMessage: "Motivo de prueba.",
      error: "Motivo de prueba.",
      nextAttemptAt: null,
    });
    expect(data).not.toHaveProperty("cancelledAt");
  });

  it("devuelve cuántos mensajes tocó", async () => {
    const total = await quarantineRecoverableMessages(db, {}, MOTIVO);
    expect(total).toBe(3);
  });
});

describe("cancelIrreversibleMessages", () => {
  let db: ReturnType<typeof dbFalso>;
  beforeEach(() => { db = dbFalso(); });

  it("toca PROGRAMADO, OMITIDO y FALLIDO -- barre también lo que ya estaba en cuarentena", async () => {
    await cancelIrreversibleMessages(db, { automationRuleId: "regla-1" }, MOTIVO);
    const { where } = db.outboundMessage.updateMany.mock.calls[0][0];
    expect(where.status.in.sort()).toEqual(["FALLIDO", "OMITIDO", "PROGRAMADO"]);
  });

  it("nunca toca un estado histórico ni uno ya cancelado", async () => {
    await cancelIrreversibleMessages(db, {}, MOTIVO);
    const { where } = db.outboundMessage.updateMany.mock.calls[0][0];
    for (const historico of ["ACEPTADO", "ENVIADO", "ENTREGADO", "LEIDO", "SIMULADO", "REBOTADO", "ENVIANDO", "CANCELADO"]) {
      expect(where.status.in).not.toContain(historico);
    }
  });

  it("pone CANCELADO con cancelledAt y el motivo", async () => {
    await cancelIrreversibleMessages(db, {}, MOTIVO);
    const { data } = db.outboundMessage.updateMany.mock.calls[0][0];
    expect(data).toMatchObject({ status: "CANCELADO", errorCode: "CODIGO_DE_PRUEBA", errorMessage: "Motivo de prueba." });
    expect(data.cancelledAt).toBeInstanceOf(Date);
  });

  it("acepta un cliente de transacción (tx) igual que el cliente global", async () => {
    const tx = dbFalso();
    const total = await cancelIrreversibleMessages(tx, { leadId: "lead-1" }, MOTIVO);
    expect(tx.outboundMessage.updateMany).toHaveBeenCalledTimes(1);
    expect(total).toBe(3);
  });
});
