"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminEmptyState } from "../AdminEmptyState";
import { AdminIcon } from "../AdminIcon";
import { useFeedback } from "../Feedback";
import {
  ASSIGNABLE_PRODUCT_ROLES,
  type AssignableProductRole,
  roleDescription,
  roleLabel,
} from "@/lib/auth/role-presentation";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type Editor =
  | { kind: "name"; user: User; value: string }
  | { kind: "password"; user: User; value: string }
  | { kind: "role"; user: User; value: AssignableProductRole };

const ECUADOR_OFFSET_MS = 5 * 60 * 60_000;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "RA";
}

function ecuadorDate(value: string) {
  const date = new Date(new Date(value).getTime() - ECUADOR_OFFSET_MS);
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth(),
    year: date.getUTCFullYear(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function formatDate(value: string) {
  const date = ecuadorDate(value);
  return `${date.day} ${MONTHS[date.month]} ${date.year}`;
}

function formatAccess(value: string | null, referenceTime: string) {
  if (!value) return { primary: "Nunca", secondary: "Sin ingresos registrados" };
  const date = new Date(value);
  const difference = Math.max(0, new Date(referenceTime).getTime() - date.getTime());
  const minutes = Math.floor(difference / 60_000);
  const hours = Math.floor(difference / 3_600_000);
  const days = Math.floor(difference / 86_400_000);
  const local = ecuadorDate(value);
  const reference = ecuadorDate(referenceTime);
  const sameDay = local.day === reference.day && local.month === reference.month && local.year === reference.year;
  const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  const primary = sameDay ? `Hoy, ${time}` : `${local.day} ${MONTHS[local.month]}, ${time}`;
  const secondary = minutes < 1 ? "Ahora" : minutes < 60 ? `Hace ${minutes} min` : hours < 24 ? `Hace ${hours} h` : `Hace ${days} d`;
  return { primary, secondary };
}

export function UserManager({ users, referenceTime }: { users: User[]; referenceTime: string }) {
  const router = useRouter();
  const { confirm } = useFeedback();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const filteredUsers = useMemo(() => users.filter((user) => {
    const matchesText = `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesText && (!roleFilter || user.role === roleFilter);
  }), [users, query, roleFilter]);

  const filterRoles = useMemo(() => {
    const roles = new Set<string>(ASSIGNABLE_PRODUCT_ROLES);
    for (const user of users) roles.add(user.role);
    return Array.from(roles);
  }, [users]);

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-user-actions]")) setOpenMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuId]);

  useEffect(() => {
    if (!editor) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditor(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => editorRef.current?.querySelector<HTMLElement>("input, select")?.focus());
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editor]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy("create");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        email: data.get("email"),
        password: data.get("password"),
        role: data.get("role"),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Usuario creado." : result.error ?? "No se pudo crear el usuario.");
    setBusy(null);
    if (response.ok) {
      form.reset();
      setShowPassword(false);
      router.refresh();
    }
  }

  async function update(user: User, body: unknown) {
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
    return response.ok;
  }

  async function saveEditor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    if (editor.kind === "password" && editor.value.length < 8) {
      setMessage("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    const body = editor.kind === "name" ? { name: editor.value.trim() }
      : editor.kind === "password" ? { password: editor.value }
        : { role: editor.value };
    if (editor.kind === "name" && !editor.value.trim()) return;
    if (await update(editor.user, body)) setEditor(null);
  }

  async function toggleActive(user: User) {
    const accepted = await confirm({
      title: user.isActive ? "Desactivar usuario" : "Activar usuario",
      body: user.isActive
        ? `${user.name} dejará de poder ingresar al CRM. Su historial se conserva.`
        : `${user.name} recuperará el acceso con su perfil actual.`,
      confirmLabel: user.isActive ? "Desactivar" : "Activar",
      tone: user.isActive ? "danger" : "normal",
    });
    if (accepted) await update(user, { isActive: !user.isActive });
  }

  function openEditor(next: Editor) {
    setOpenMenuId(null);
    setEditor(next);
  }

  return <>
    <details className="panel user-create-panel">
      <summary>
        <span><strong>Nuevo usuario administrativo</strong><small>Crea una cuenta individual con perfil Dirección o Técnico.</small></span>
        <span className="btn-sm" aria-hidden="true">Nuevo usuario</span>
      </summary>
      <form onSubmit={create}>
        <div className="form-row">
          <input name="name" aria-label="Nombre" placeholder="Nombre" required />
          <input name="email" type="email" aria-label="Correo" placeholder="Correo" required />
          <div className="login-password-field">
            <input name="password" type={showPassword ? "text" : "password"} minLength={8} aria-label="Contraseña inicial" placeholder="Contraseña inicial" required />
            <button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>{showPassword ? "Ocultar" : "Mostrar"}</button>
          </div>
          <select name="role" aria-label="Perfil" defaultValue="DIRECCION">
            {ASSIGNABLE_PRODUCT_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
          </select>
        </div>
        <p className="muted">Dirección gestiona la operación. Técnico añade herramientas de sistema y diagnóstico.</p>
        <button type="submit" className="btn-sm" disabled={busy === "create"}>{busy === "create" ? "Creando…" : "Crear usuario"}</button>
      </form>
    </details>

    <section className="panel users-panel">
      <div className="users-panel-heading">
        <div><h2>Equipo con acceso</h2><p className="muted">{users.length} {users.length === 1 ? "usuario registrado" : "usuarios registrados"}</p></div>
        {message ? <span className="result-line" role="status">{message}</span> : null}
      </div>
      <search className="filter-bar users-filter-bar" aria-label="Filtros de usuarios">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar usuarios" placeholder="Buscar por nombre o correo" />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filtrar por perfil">
          <option value="">Todos los perfiles</option>
          {filterRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
        </select>
      </search>
      {users.length === 0 ? <AdminEmptyState icon="users" title="No hay usuarios administrativos" description="Crea el primer perfil para comenzar." />
        : filteredUsers.length === 0 ? <AdminEmptyState icon="users" title="Sin resultados" description="No hay usuarios que coincidan con los filtros." />
          : <div className="table-wrap users-table-wrap"><table className="data users-table"><thead><tr><th>Usuario</th><th>Perfil</th><th>Último acceso</th><th>Creación</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filteredUsers.map((user) => {
            const access = formatAccess(user.lastLoginAt, referenceTime);
            const assignableRole = ASSIGNABLE_PRODUCT_ROLES.includes(user.role as AssignableProductRole) ? user.role as AssignableProductRole : "DIRECCION";
            return <tr className="users-table-row" key={user.id}>
              <td data-label="Usuario"><div className="user-identity-cell"><span className="admin-avatar" aria-hidden="true">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{user.email}</small></span></div></td>
              <td data-label="Perfil"><span className={`role-badge ${user.role === "ADMIN" ? "is-technical" : user.role === "DIRECCION" ? "is-direction" : "is-legacy"}`}>{roleLabel(user.role)}</span><small className="user-role-description">{roleDescription(user.role)}</small></td>
              <td data-label="Último acceso"><span className="user-date"><strong>{access.primary}</strong><small>{access.secondary}</small></span></td>
              <td data-label="Creación"><span className="user-date"><strong>{formatDate(user.createdAt)}</strong></span></td>
              <td data-label="Estado"><span className={`pill ${user.isActive ? "ok" : ""}`}>{user.isActive ? "Activo" : "Inactivo"}</span></td>
              <td className="user-actions-cell" data-label="Acciones">
                <div className="user-actions" data-user-actions>
                  <button className="icon-button" type="button" disabled={busy === user.id} aria-label={`Acciones de ${user.name}`} aria-haspopup="menu" aria-expanded={openMenuId === user.id} onClick={() => setOpenMenuId((current) => current === user.id ? null : user.id)}>•••</button>
                  {openMenuId === user.id ? <div className="user-actions-menu" role="menu">
                    <button type="button" role="menuitem" onClick={() => openEditor({ kind: "name", user, value: user.name })}>Editar perfil</button>
                    <button type="button" role="menuitem" onClick={() => openEditor({ kind: "role", user, value: assignableRole })}>Cambiar rol</button>
                    <button type="button" role="menuitem" onClick={() => openEditor({ kind: "password", user, value: "" })}>Restablecer contraseña</button>
                    <button type="button" role="menuitem" className={user.isActive ? "is-danger" : ""} onClick={() => { setOpenMenuId(null); void toggleActive(user); }}>{user.isActive ? "Desactivar" : "Activar"}</button>
                  </div> : null}
                </div>
              </td>
            </tr>;
          })}</tbody></table></div>}
    </section>

    {editor ? <div className="dialog-backdrop" role="presentation">
      <div className="dialog user-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="user-editor-title" ref={editorRef}>
        <div className="user-editor-header"><div><span className="eyebrow">Usuarios</span><h2 id="user-editor-title">{editor.kind === "role" ? "Cambiar perfil" : editor.kind === "password" ? "Restablecer contraseña" : "Editar perfil"}</h2></div><button className="icon-button" type="button" aria-label="Cerrar" onClick={() => setEditor(null)}><AdminIcon name="close" size={18} /></button></div>
        <form onSubmit={saveEditor}>
          <dl className="user-editor-summary"><dt>Usuario</dt><dd>{editor.user.name}</dd>{editor.kind === "role" ? <><dt>Perfil actual</dt><dd>{roleLabel(editor.user.role)}</dd></> : null}</dl>
          {editor.kind === "name" ? <label className="field">Nombre<input value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} required /></label> : null}
          {editor.kind === "password" ? <label className="field">Nueva contraseña<input type="password" value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value })} minLength={8} autoComplete="new-password" required /><small>Mínimo 8 caracteres.</small></label> : null}
          {editor.kind === "role" ? <label className="field">Nuevo perfil<select value={editor.value} onChange={(event) => setEditor({ ...editor, value: event.target.value as AssignableProductRole })}>{ASSIGNABLE_PRODUCT_ROLES.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label> : null}
          {editor.kind === "role" && editor.value === "ADMIN" ? <p className="user-editor-note">Técnico tendrá acceso además a herramientas de sistema y diagnóstico.</p> : null}
          <div className="dialog-actions"><button type="button" className="btn-sm ghost" onClick={() => setEditor(null)}>Cancelar</button><button type="submit" className="btn-sm" disabled={busy === editor.user.id}>{busy === editor.user.id ? "Guardando…" : editor.kind === "role" ? "Guardar cambio" : "Guardar"}</button></div>
        </form>
      </div>
    </div> : null}
  </>;
}
