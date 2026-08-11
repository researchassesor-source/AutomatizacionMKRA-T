import Link from "next/link";
import { prisma } from "@/lib/db";
import { financeAppUrl, financeVerificationUrl } from "@/lib/finance/client";
import { canHandoffToFinance } from "@/lib/finance/authorization";
import { currentAdminSession } from "@/lib/auth/server";
import { CONSULTA } from "@/lib/auth/roles";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { presentAdminValue } from "../adminPresentation";
import { FinanceAction } from "./FinanceAction";

export const dynamic = "force-dynamic";

export default async function FinanceEnrollmentsPage() {
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!CONSULTA.includes(session.role)) {
    return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar los envíos a Finance." /></main>;
  }
  const enrollments = await prisma.enrollment.findMany({
    where: { OR: [{ status: "COMPLETADO" }, { financeStatus: { not: "NO_ENVIADO" } }] },
    include: { lead: true, course: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return <main className="container admin-shell">
    <AdminNav view={view} />
    <AdminPageHeader eyebrow="Integración controlada" title="Envíos a Finance" description="Consulta las finalizaciones preparadas y el último estado informado por Finance." actions={financeAppUrl() ? <a className="btn-sm ghost" href={financeAppUrl()} target="_blank" rel="noreferrer">Abrir Finance ↗</a> : null} />
    <section className="admin-notice"><span>Finance conserva la autoridad sobre emisión, QR, anulación y verificación. El CRM solo presenta la última información conocida.</span></section>
    <section className="panel">{enrollments.length === 0 ? <AdminEmptyState icon="finance" title="Aún no hay finalizaciones preparadas" description="Los envíos disponibles para Finance aparecerán en esta vista." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Contacto</th><th>Curso</th><th>Finalización</th><th>Envío a Finance</th><th>Certificado</th><th>Referencia</th><th>Acciones</th></tr></thead><tbody>{enrollments.map((item) => <tr key={item.id}><td><Link href={`/admin/leads/${item.leadId}`}>{item.lead.fullName}</Link><div className="muted">{item.lead.email}</div></td><td>{item.course.title}</td><td>{item.moodleCompletionDate ? new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeZone: "America/Guayaquil" }).format(item.moodleCompletionDate) : "Manual"}</td><td><span className={`pill ${item.financeStatus === "ENVIADO" ? "ok" : item.financeStatus === "ERROR" ? "err" : "warn"}`}>{presentAdminValue(item.financeStatus)}</span>{item.lastHandoffError && <div className="muted">{item.lastHandoffError}</div>}</td><td>{presentAdminValue(item.certificateStatus)}</td><td>{item.financeInscripcionId ?? "—"}</td><td>{item.financeInscripcionId ? <a className="btn-sm ghost" href={financeVerificationUrl(item.financeInscripcionId)} target="_blank" rel="noreferrer">Verificar ↗</a> : canHandoffToFinance(session.role) ? <FinanceAction enrollmentId={item.id} label={item.financeStatus === "ERROR" ? "Reintentar" : "Preparar envío"} /> : "—"}</td></tr>)}</tbody></table></div>}</section>
  </main>;
}
