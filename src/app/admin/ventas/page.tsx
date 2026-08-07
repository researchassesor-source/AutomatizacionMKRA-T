import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { resolveViewMode } from "@/lib/auth/view-mode";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminFilterPanel } from "../AdminFilterPanel";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { VentasManager } from "./VentasManager";
import { UMBRAL_OPORTUNIDAD } from "@/lib/scoring";

export const dynamic = "force-dynamic";
type ScoreItem = { label: string; points: number };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; course?: string; assigned?: string }> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  const view = await resolveViewMode(session.role);
  if (!session || !["ADMIN", "VENTAS"].includes(session.role)) return <main className="container admin-shell"><AdminNav view={view} /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para administrar el pipeline." /></main>;
  const common: Prisma.LeadWhereInput = {
    isArchived: false,
    ...(filters.q ? { OR: [{ fullName: { contains: filters.q, mode: "insensitive" } }, { email: { contains: filters.q, mode: "insensitive" } }, { phone: { contains: filters.q } }] } : {}),
    ...(filters.course ? { enrollments: { some: { courseId: filters.course } } } : {}),
    ...(filters.assigned ? { assignedToId: filters.assigned } : {}),
  };
  const include = { enrollments: { include: { course: true } }, assignedTo: true } as const;
  const [opportunities, clients, lost, courses, users] = await Promise.all([
    prisma.lead.findMany({ where: { ...common, stage: "OPORTUNIDAD" }, orderBy: { score: "desc" }, include, take: 100 }),
    prisma.lead.findMany({ where: { ...common, stage: "CLIENTE" }, orderBy: { updatedAt: "desc" }, include, take: 100 }),
    prisma.lead.findMany({ where: { ...common, stage: "PERDIDO" }, orderBy: { updatedAt: "desc" }, include, take: 100 }),
    prisma.course.findMany({ where: { isPublished: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.adminUser.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const serialize = (lead: (typeof opportunities)[number]) => ({
    id: lead.id, fullName: lead.fullName, email: lead.email, phone: lead.phone, stage: lead.stage,
    score: lead.score, breakdown: Array.isArray(lead.scoreBreakdown) ? lead.scoreBreakdown as unknown as ScoreItem[] : [],
    course: lead.enrollments.map((item) => item.course.title).join(", ") || null,
    assignedTo: lead.assignedTo?.name ?? null, lostReason: lead.lostReason,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null,
  });
  return <main className="container admin-shell"><AdminNav view={view} /><AdminPageHeader eyebrow="Puntaje comercial" title="Pipeline de ventas" description="Prioriza oportunidades, acompaña cierres y conserva el contexto de cada negociación." actions={<span className="pill info">Umbral de oportunidad: {UMBRAL_OPORTUNIDAD}</span>} /><form><AdminFilterPanel label="Filtros del pipeline"><div className="filter-bar"><input name="q" aria-label="Buscar por nombre, correo o WhatsApp" defaultValue={filters.q} placeholder="Nombre, correo o WhatsApp" /><select name="course" aria-label="Filtrar ventas por curso" defaultValue={filters.course ?? ""}><option value="">Todos los cursos activos</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}</select><select name="assigned" aria-label="Filtrar ventas por responsable" defaultValue={filters.assigned ?? ""}><option value="">Todos los responsables</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><button type="submit" className="btn-sm">Filtrar</button></div></AdminFilterPanel></form><VentasManager oportunidades={opportunities.map(serialize)} clientes={clients.map(serialize)} perdidos={lost.map(serialize)} /></main>;
}
