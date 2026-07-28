import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentAdminSession } from "@/lib/auth/server";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminFilterPanel } from "../AdminFilterPanel";
import { AdminNav } from "../AdminNav";
import { AdminPageHeader } from "../AdminPageHeader";
import { presentAdminValue } from "../adminPresentation";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; entity?: string; result?: string }> }) {
  const filters = await searchParams;
  const session = await currentAdminSession();
  if (session?.role !== "ADMIN") return <main className="container admin-shell"><AdminNav /><AdminEmptyState icon="secure" title="Acceso restringido" description="No tienes permisos para consultar la auditoría." /></main>;
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.action ? { action: { contains: filters.action, mode: "insensitive" } } : {}),
    ...(filters.entity ? { entityType: filters.entity } : {}),
    ...(filters.result ? { result: filters.result } : {}),
  };
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 });
  return <main className="container admin-shell"><AdminNav /><AdminPageHeader eyebrow="Control interno" title="Auditoría" description="Revisa los eventos registrados para comprender quién hizo qué y con qué resultado." /><form><AdminFilterPanel label="Filtros de auditoría"><div className="filter-bar"><input name="action" defaultValue={filters.action} placeholder="Buscar acción" /><input name="entity" defaultValue={filters.entity} placeholder="Tipo de registro" /><select name="result" defaultValue={filters.result ?? ""}><option value="">Todos los resultados</option><option value="SUCCESS">Correcto</option><option value="FAILURE">Fallido</option></select><button type="submit" className="btn-sm">Filtrar</button><Link className="btn-sm ghost" href="/admin/auditoria">Limpiar</Link></div></AdminFilterPanel></form><section className="panel">{logs.length === 0 ? <AdminEmptyState icon="audit" title="No hay eventos con estos filtros" description="Ajusta los criterios o limpia la búsqueda para ver otros registros." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Fecha</th><th>Actor</th><th>Acción</th><th>Registro</th><th>Resultado</th><th>Referencia</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td>{new Intl.DateTimeFormat("es-EC", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Guayaquil" }).format(log.createdAt)}</td><td>{log.actorEmail ?? "Sistema"}</td><td>{presentAdminValue(log.action)}</td><td>{presentAdminValue(log.entityType)}</td><td><span className={`pill ${log.result === "SUCCESS" ? "ok" : "err"}`}>{log.result === "SUCCESS" ? "Correcto" : "Fallido"}</span></td><td>{log.entityId ?? "—"}</td></tr>)}</tbody></table></div>}</section></main>;
}
