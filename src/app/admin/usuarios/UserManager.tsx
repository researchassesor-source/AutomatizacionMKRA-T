"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../AdminEmptyState";
import { presentAdminValue } from "../adminPresentation";

export function UserManager({ users }: { users: { id: string; name: string; email: string; role: string; isActive: boolean; lastLoginAt: string | null }[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: data.get("name"), email: data.get("email"), password: data.get("password"), role: data.get("role") }) });
    const result = await response.json(); setMessage(response.ok ? "Usuario creado." : result.error); if (response.ok) { form.reset(); router.refresh(); }
  }
  async function update(id: string, body: unknown) {
    const response = await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json(); setMessage(response.ok ? "Usuario actualizado." : result.error); router.refresh();
  }
  return <>
    <form className="panel" onSubmit={create}><h2>Nuevo usuario administrativo</h2><div className="form-row"><input name="name" aria-label="Nombre" placeholder="Nombre" required /><input name="email" type="email" aria-label="Correo" placeholder="Correo" required /><input name="password" type="password" minLength={8} aria-label="Contraseña inicial" placeholder="Contraseña inicial" required /><select name="role" aria-label="Rol"><option value="LECTURA">Solo lectura</option><option value="VENTAS">Ventas</option><option value="MARKETING">Marketing</option><option value="ADMIN">Administrador</option></select></div><button type="submit" className="btn-sm">Crear usuario</button>{message && <span className="result-line" role="status">{message}</span>}</form>
    <section className="panel">{users.length === 0 ? <AdminEmptyState icon="users" title="No hay usuarios administrativos" description="Crea el primer perfil para comenzar." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Usuario</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><div className="muted">{user.email}</div></td><td><select aria-label={`Rol de ${user.name}`} value={user.role} onChange={(event) => update(user.id, { role: event.target.value })}>{["ADMIN","MARKETING","VENTAS","LECTURA"].map((role) => <option key={role} value={role}>{presentAdminValue(role)}</option>)}</select></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("es-EC") : "Nunca"}</td><td><span className={`pill ${user.isActive ? "ok" : ""}`}>{user.isActive ? "Activo" : "Inactivo"}</span></td><td><button className="btn-sm ghost" type="button" onClick={() => update(user.id, { isActive: !user.isActive })}>{user.isActive ? "Desactivar" : "Activar"}</button></td></tr>)}</tbody></table></div>}</section>
  </>;
}
