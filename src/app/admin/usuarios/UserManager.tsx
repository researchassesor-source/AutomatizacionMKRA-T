"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../AdminEmptyState";
import { presentAdminValue } from "../adminPresentation";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const roleDescriptions: Record<string, string> = {
  ADMIN: "Control completo, usuarios y auditoría.",
  MARKETING: "Cursos, mensajes, redes y lectura de contactos.",
  VENTAS: "Contactos, seguimientos, ventas, mensajes y Finance.",
  LECTURA: "Consulta de resumen, contactos, cursos y Finance.",
};

export function UserManager({ users }: { users: User[] }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const filteredUsers = useMemo(() => users.filter((user) => {
    const matchesText = `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesText && (!roleFilter || user.role === roleFilter);
  }), [users, query, roleFilter]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("create");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), email: data.get("email"), password: data.get("password"), role: data.get("role") }),
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Usuario creado." : result.error ?? "No se pudo crear el usuario.");
    setBusy(null);
    if (response.ok) { form.reset(); setShowPassword(false); router.refresh(); }
  }

  async function update(user: User, body: unknown, confirmation: string) {
    if (!window.confirm(confirmation)) return;
    setBusy(user.id);
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Usuario actualizado." : result.error ?? "No se pudo actualizar el usuario.");
    setBusy(null);
    if (response.ok) router.refresh();
  }

  function editName(user: User) {
    const name = window.prompt("Nombre del usuario", user.name)?.trim();
    if (!name || name === user.name) return;
    void update(user, { name }, `¿Guardar el nuevo nombre de ${user.email}?`);
  }

  function resetPassword(user: User) {
    const password = window.prompt(`Nueva contraseña para ${user.email} (mínimo 8 caracteres)`);
    if (!password) return;
    if (password.length < 8) { setMessage("La contraseña debe tener al menos 8 caracteres."); return; }
    void update(user, { password }, `¿Restablecer la contraseña de ${user.email}? Sus sesiones actuales dejarán de ser confiables al volver a autenticarse.`);
  }

  return <>
    <form className="panel" onSubmit={create}>
      <h2>Nuevo usuario administrativo</h2>
      <p className="muted">Las cuentas individuales usan contraseña cifrada de al menos 8 caracteres.</p>
      <div className="form-row">
        <input name="name" aria-label="Nombre" placeholder="Nombre" required />
        <input name="email" type="email" aria-label="Correo" placeholder="Correo" required />
        <div className="login-password-field">
          <input name="password" type={showPassword ? "text" : "password"} minLength={8} aria-label="Contraseña inicial" placeholder="Contraseña inicial" required />
          <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? "Ocultar" : "Mostrar"}</button>
        </div>
        <select name="role" aria-label="Rol" defaultValue="LECTURA">{["LECTURA", "VENTAS", "MARKETING", "ADMIN"].map((role) => <option key={role} value={role}>{presentAdminValue(role)}</option>)}</select>
      </div>
      <p className="muted">Administrador: control completo · Marketing: automatización · Ventas: gestión comercial · Lectura: solo consulta.</p>
      <button type="submit" className="btn-sm" disabled={busy === "create"}>{busy === "create" ? "Creando…" : "Crear usuario"}</button>
      {message && <span className="result-line" role="status">{message}</span>}
    </form>

    <section className="panel">
      <search className="filter-bar" aria-label="Filtros de usuarios">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar usuarios" placeholder="Buscar por nombre o correo" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filtrar por rol"><option value="">Todos los roles</option>{["ADMIN", "MARKETING", "VENTAS", "LECTURA"].map((role) => <option key={role} value={role}>{presentAdminValue(role)}</option>)}</select>
      </search>
      {users.length === 0 ? <AdminEmptyState icon="users" title="No hay usuarios administrativos" description="Crea el primer perfil para comenzar." /> : filteredUsers.length === 0 ? <AdminEmptyState icon="users" title="Sin resultados" description="No hay usuarios que coincidan con los filtros." /> : <div className="table-wrap"><table className="data"><thead><tr><th>Usuario</th><th>Rol</th><th>Último acceso</th><th>Creación</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><div className="muted">{user.email}</div></td><td><select aria-label={`Rol de ${user.name}`} value={user.role} disabled={busy === user.id} title={roleDescriptions[user.role]} onChange={(event) => { const role = event.target.value; void update(user, { role }, `¿Cambiar el rol de ${user.name} a ${presentAdminValue(role)}?`); }}>{["ADMIN", "MARKETING", "VENTAS", "LECTURA"].map((role) => <option key={role} value={role}>{presentAdminValue(role)}</option>)}</select><div className="muted">{roleDescriptions[user.role]}</div></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) : "Nunca"}</td><td>{new Date(user.createdAt).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" })}</td><td><span className={`pill ${user.isActive ? "ok" : ""}`}>{user.isActive ? "Activo" : "Inactivo"}</span></td><td><div className="card-actions"><button className="btn-sm ghost" type="button" disabled={busy === user.id} onClick={() => editName(user)}>Editar perfil</button><button className="btn-sm ghost" type="button" disabled={busy === user.id} onClick={() => resetPassword(user)}>Restablecer contraseña</button><button className={user.isActive ? "btn-sm danger" : "btn-sm ghost"} type="button" disabled={busy === user.id} onClick={() => void update(user, { isActive: !user.isActive }, `¿${user.isActive ? "Desactivar" : "Activar"} la cuenta de ${user.name}?`)}>{user.isActive ? "Desactivar" : "Activar"}</button></div></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
