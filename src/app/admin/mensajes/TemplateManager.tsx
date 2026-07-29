"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TemplateManager() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/admin/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), channel: data.get("channel"), subject: data.get("subject"), body: data.get("body"), category: data.get("category"), isActive: true }) });
    const result = await response.json();
    setMessage(response.ok ? "Plantilla creada." : result.error);
    if (response.ok) { form.reset(); router.refresh(); }
  }
  return <form className="panel" onSubmit={submit}><h2>Nueva plantilla</h2><p className="muted">Variables: {"{{nombre}}, {{apellido}}, {{curso}}, {{courseUrl}}, {{moodleUrl}}, {{asesor}}, {{fecha}}, {{appUrl}}"}</p><div className="form-row"><input name="name" aria-label="Nombre de la plantilla" placeholder="Nombre" required /><select name="channel" aria-label="Canal"><option value="EMAIL">Correo</option><option value="WHATSAPP">WhatsApp</option></select><input name="category" aria-label="Categoría" placeholder="Categoría" /><input name="subject" aria-label="Asunto del correo" placeholder="Asunto (correo)" /></div><div className="form-row"><textarea name="body" aria-label="Cuerpo del mensaje" rows={4} placeholder="Cuerpo del mensaje" required /></div><button type="submit" className="btn-sm">Crear plantilla</button>{message && <span className="result-line" role="status">{message}</span>}</form>;
}
