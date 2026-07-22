import { prisma } from "@/lib/db";

// Genera un folio publico legible y dificil de adivinar.
// Formato: RA-<anio>-<6 chars base32 sin caracteres ambiguos>
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0, 1

function randomFolio(): string {
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return `RA-${new Date().getFullYear()}-${code}`;
}

async function uniqueFolio(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const folio = randomFolio();
    const exists = await prisma.certificate.findUnique({ where: { folio } });
    if (!exists) return folio;
  }
  throw new Error("no se pudo generar un folio unico");
}

/**
 * Emite (o devuelve, si ya existe) el certificado de un lead para un curso.
 * Transiciona el lead a CERTIFICADO y encola el aviso "certificado listo".
 */
export async function issueCertificate(leadId: string, courseId: string) {
  const existing = await prisma.certificate.findUnique({
    where: { leadId_courseId: { leadId, courseId } },
  });
  if (existing) return existing;

  const [lead, course] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.course.findUnique({ where: { id: courseId } }),
  ]);
  if (!lead) throw new Error("lead no encontrado");
  if (!course) throw new Error("curso no encontrado");

  const certificate = await prisma.certificate.create({
    data: {
      folio: await uniqueFolio(),
      leadId,
      courseId,
      holderName: lead.fullName,
      courseTitle: course.title,
      official: course.hasCertificate, // solo oficial si el curso lo tiene avalado
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: { stage: "CERTIFICADO" },
  });

  await prisma.leadEvent.create({
    data: {
      leadId,
      type: "course_complete",
      payload: { courseId, folio: certificate.folio },
    },
  });

  // Aviso de certificado listo (se enviara en el proximo dispatch).
  const appUrl = process.env.APP_URL ?? "https://ra-training.com";
  const nombre = lead.fullName.split(" ")[0] ?? lead.fullName;
  await prisma.outboundMessage.create({
    data: {
      leadId,
      channel: "EMAIL",
      toAddress: lead.email,
      subject: "🎓 Tu certificado esta listo",
      body: [
        `Hola ${nombre},`,
        "",
        `¡Felicidades por completar "${course.title}"!`,
        "Ya puedes descargar y verificar tu certificado aqui:",
        "",
        `${appUrl}/certificado/${certificate.folio}`,
        "",
        `Codigo de verificacion: ${certificate.folio}`,
        "",
        "El equipo de RA-Training",
      ].join("\n"),
      status: "PROGRAMADO",
      scheduledAt: new Date(),
      sequenceKey: "certificado",
      stepKey: "listo",
    },
  });

  return certificate;
}

/** Busca un certificado por folio para la pagina de verificacion publica. */
export async function verifyFolio(folio: string) {
  const cert = await prisma.certificate.findUnique({
    where: { folio: folio.trim().toUpperCase() },
  });
  if (!cert || cert.revoked) return null;
  return cert;
}
