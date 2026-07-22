import { prisma } from "@/lib/db";
import type { Lead, LeadEvent, LeadStage } from "@prisma/client";

// Pesos del scoring de ventas. Ajustables en un solo lugar.
export const SCORE_WEIGHTS = {
  captura: 10, // se registro en una landing
  whatsapp: 15, // dejo telefono -> mas contactable
  cursoCompletado: 40, // completo un curso gratuito (senal fuerte)
  certificadoEmitido: 10, // ademas ya tiene certificado emitido
  cursoAdicional: 10, // por cada curso extra completado
  reciente: 5, // se registro en los ultimos 7 dias
};

// A partir de este puntaje, el lead se considera OPORTUNIDAD de venta.
export const UMBRAL_OPORTUNIDAD = 50;

export type ScoreItem = { label: string; points: number };

export function computeScore(
  lead: Pick<Lead, "phone" | "createdAt">,
  events: Pick<LeadEvent, "type">[],
): { score: number; breakdown: ScoreItem[] } {
  const breakdown: ScoreItem[] = [];
  const add = (label: string, points: number) => {
    if (points) breakdown.push({ label, points });
  };

  add("Captura del lead", SCORE_WEIGHTS.captura);
  if (lead.phone) add("Dejo WhatsApp", SCORE_WEIGHTS.whatsapp);

  const completions = events.filter(
    (e) => e.type === "finance_handoff" || e.type === "certificate_issued",
  ).length;
  if (completions > 0) add("Completo un curso", SCORE_WEIGHTS.cursoCompletado);
  if (completions > 1) {
    add(
      `Cursos adicionales (${completions - 1})`,
      SCORE_WEIGHTS.cursoAdicional * (completions - 1),
    );
  }

  const certificados = events.filter((e) => e.type === "certificate_issued").length;
  if (certificados > 0) add("Certificado emitido", SCORE_WEIGHTS.certificadoEmitido);

  const dias = (Date.now() - new Date(lead.createdAt).getTime()) / 86_400_000;
  if (dias <= 7) add("Lead reciente", SCORE_WEIGHTS.reciente);

  const score = breakdown.reduce((s, b) => s + b.points, 0);
  return { score, breakdown };
}

// Etapas desde las que un lead puede promoverse automaticamente a OPORTUNIDAD.
const PROMOVIBLES: LeadStage[] = ["NUEVO", "INSCRITO", "EN_CURSO", "CERTIFICADO"];

/** Recalcula el score de un lead y lo promueve a OPORTUNIDAD si califica. */
export async function rescoreLead(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { events: { select: { type: true } } },
  });
  if (!lead) return null;

  const { score, breakdown } = computeScore(lead, lead.events);

  const promueve =
    score >= UMBRAL_OPORTUNIDAD && PROMOVIBLES.includes(lead.stage);
  const stage: LeadStage = promueve ? "OPORTUNIDAD" : lead.stage;

  return prisma.lead.update({
    where: { id: leadId },
    data: { score, scoreBreakdown: breakdown, scoredAt: new Date(), stage },
  });
}

/** Recalcula el score de todos los leads. Para el boton del panel o un cron. */
export async function rescoreAll() {
  const leads = await prisma.lead.findMany({ select: { id: true }, take: 1000 });
  let promovidos = 0;
  for (const { id } of leads) {
    const before = await prisma.lead.findUnique({
      where: { id },
      select: { stage: true },
    });
    const updated = await rescoreLead(id);
    if (before?.stage !== "OPORTUNIDAD" && updated?.stage === "OPORTUNIDAD") {
      promovidos++;
    }
  }
  return { total: leads.length, promovidos };
}
