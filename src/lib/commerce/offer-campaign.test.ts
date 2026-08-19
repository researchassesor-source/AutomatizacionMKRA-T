// biome-ignore-all lint/suspicious/noExplicitAny: Los dobles de Prisma usan objetos parciales controlados por la prueba.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    certificationOfferCampaign: { findUnique: vi.fn(), update: vi.fn() },
    course: { findUnique: vi.fn() },
  },
  writeAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.writeAudit }));

import { reprogramarOfertaAutomatica } from "./offer-campaign";
import { calcularEnvioAutomatico } from "./offer-schedule";

const SESSION_OLD_END = new Date("2026-08-13T02:00:00.000Z");
const SESSION_NEW_END = new Date("2026-08-27T02:00:00.000Z");

function curso(overrides: Partial<{ sessions: any[]; institutionalOfferDelayHours: number }> = {}) {
  return {
    id: "course-1",
    institutionalOfferDelayHours: overrides.institutionalOfferDelayHours ?? 24,
    sessions: overrides.sessions ?? [{ id: "s1", title: null, startAt: SESSION_NEW_END, endAt: SESSION_NEW_END, streamUrl: null }],
  };
}

function campana(overrides: Partial<{ audienceMode: string; status: string; automaticScheduledAt: Date | null }> = {}) {
  return {
    id: "campaign-1",
    courseId: "course-1",
    audienceMode: overrides.audienceMode ?? "AUTOMATIC_COMMERCE",
    status: overrides.status ?? "SCHEDULED",
    automaticScheduledAt: overrides.automaticScheduledAt === undefined ? SESSION_OLD_END : overrides.automaticScheduledAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.course.findUnique.mockResolvedValue(curso());
  mocks.prisma.certificationOfferCampaign.update.mockImplementation(async ({ data }: any) => ({ ...campana(), ...data }));
});

/**
 * Sección 9 del release de estabilización: la oferta institucional #12
 * automática se quedaba con la fecha del día que se creó la campaña, aunque
 * el calendario del curso cambiara después.
 */
describe("reprogramarOfertaAutomatica", () => {
  it("sin campaña para el curso, no hace nada", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(null);
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).not.toHaveBeenCalled();
  });

  it("campaña histórica (HISTORICAL_MANUAL) nunca se toca", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ audienceMode: "HISTORICAL_MANUAL" }));
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).not.toHaveBeenCalled();
  });

  it("campaña COMPLETED nunca se reabre", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ status: "COMPLETED" }));
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).not.toHaveBeenCalled();
  });

  it("campaña RUNNING no se toca (ya se está procesando)", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ status: "RUNNING" }));
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).not.toHaveBeenCalled();
  });

  it("SCHEDULED con fecha realmente distinta: actualiza y audita", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ automaticScheduledAt: SESSION_OLD_END }));
    const resultado = await reprogramarOfertaAutomatica("course-1", { email: "tecnico@example.test" });
    expect(resultado).not.toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).toHaveBeenCalledWith({
      where: { id: "campaign-1" },
      data: { automaticScheduledAt: expect.any(Date), status: "SCHEDULED" },
    });
    const nuevaFecha = mocks.prisma.certificationOfferCampaign.update.mock.calls[0][0].data.automaticScheduledAt;
    expect(nuevaFecha.getTime()).not.toBe(SESSION_OLD_END.getTime());
    expect(mocks.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "CERT_OFFER_CAMPAIGN_RESCHEDULED" }));
  });

  it("sin cambio real en la fecha calculada: no escribe nada", async () => {
    // Fecha ya coincide con lo que produciría el cálculo actual (mismo
    // cálculo real, no una aproximación de la prueba).
    const yaCoincide = calcularEnvioAutomatico(curso().sessions as any, 24);
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ automaticScheduledAt: yaCoincide }));
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).not.toHaveBeenCalled();
  });

  it("DRAFT sin fecha previa que ahora sí puede calcularse pasa a SCHEDULED", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ status: "DRAFT", automaticScheduledAt: null }));
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).not.toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).toHaveBeenCalledWith({
      where: { id: "campaign-1" },
      data: { automaticScheduledAt: expect.any(Date), status: "SCHEDULED" },
    });
  });

  it("curso sin sesiones ya no calculables deja la campaña en DRAFT sin fecha", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana({ automaticScheduledAt: SESSION_OLD_END }));
    mocks.prisma.course.findUnique.mockResolvedValue(curso({ sessions: [] }));
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(mocks.prisma.certificationOfferCampaign.update).toHaveBeenCalledWith({
      where: { id: "campaign-1" },
      data: { automaticScheduledAt: null, status: "DRAFT" },
    });
    expect(resultado).not.toBeNull();
  });

  it("curso inexistente no revienta, solo no hace nada", async () => {
    mocks.prisma.certificationOfferCampaign.findUnique.mockResolvedValue(campana());
    mocks.prisma.course.findUnique.mockResolvedValue(null);
    const resultado = await reprogramarOfertaAutomatica("course-1");
    expect(resultado).toBeNull();
    expect(mocks.prisma.certificationOfferCampaign.update).not.toHaveBeenCalled();
  });
});
