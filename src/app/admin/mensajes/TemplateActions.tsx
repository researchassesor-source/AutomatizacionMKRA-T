"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Template = { id: string; name: string; channel: string; subject: string | null; body: string; category: string | null; isActive: boolean };

async function request(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, data: await response.json().catch(() => ({})) };
}

export function TemplateActions({ template }: { template: Template }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function edit() {
    const name = window.prompt("Nombre de la plantilla", template.name)?.trim();
    if (!name) return;
    const subject = template.channel === "EMAIL" ? window.prompt("Asunto del correo", template.subject ?? "")?.trim() : null;
    if (template.channel === "EMAIL" && !subject) return;
    const body = window.prompt("Contenido de la plantilla", template.body)?.trim();
    if (!body || !window.confirm("¿Guardar los cambios de esta plantilla?")) return;
    setBusy(true);
    const result = await request(`/api/admin/templates/${template.id}`, "PATCH", { name, subject, body, category: template.category, confirm: true });
    setMessage(result.ok ? "Plantilla actualizada." : result.data.error);
    setBusy(false);
    if (result.ok) router.refresh();
  }

  async function duplicate() {
    if (!window.confirm(`¿Duplicar la plantilla “${template.name}”?`)) return;
    setBusy(true);
    const result = await request("/api/admin/templates", "POST", { name: `${template.name} (copia)`, channel: template.channel, subject: template.subject ?? "", body: template.body, category: template.category ?? "", isActive: false });
    setMessage(result.ok ? "Plantilla duplicada como inactiva." : result.data.error);
    setBusy(false);
    if (result.ok) router.refresh();
  }

  async function toggle() {
    if (!window.confirm(`¿${template.isActive ? "Desactivar" : "Activar"} esta plantilla?`)) return;
    setBusy(true);
    const result = await request(`/api/admin/templates/${template.id}`, "PATCH", { isActive: !template.isActive, confirm: true });
    setMessage(result.ok ? "Estado de plantilla actualizado." : result.data.error);
    setBusy(false);
    if (result.ok) router.refresh();
  }

  return <div><div className="card-actions"><button type="button" className="btn-sm ghost" disabled={busy} onClick={edit}>Editar</button><button type="button" className="btn-sm ghost" disabled={busy} onClick={duplicate}>Duplicar</button><button type="button" className={template.isActive ? "btn-sm danger" : "btn-sm ghost"} disabled={busy} onClick={toggle}>{template.isActive ? "Desactivar" : "Activar"}</button></div>{message && <div className="muted" role="status">{message}</div>}</div>;
}
