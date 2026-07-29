"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import { presentAdminValue } from "./adminPresentation";

type AdminLink = {
  href: string;
  label: string;
  icon: AdminIconName;
  roles: string[];
};

const navigation: Array<{ label: string; links: AdminLink[] }> = [
  {
    label: "General",
    links: [
      { href: "/admin", label: "Resumen", icon: "overview", roles: ["ADMIN", "MARKETING", "VENTAS", "LECTURA"] },
    ],
  },
  {
    label: "Gestión comercial",
    links: [
      { href: "/admin/leads", label: "Contactos", icon: "contacts", roles: ["ADMIN", "MARKETING", "VENTAS", "LECTURA"] },
      { href: "/admin/seguimientos", label: "Seguimientos", icon: "followups", roles: ["ADMIN", "VENTAS"] },
      { href: "/admin/ventas", label: "Ventas", icon: "sales", roles: ["ADMIN", "VENTAS"] },
    ],
  },
  {
    label: "Capacitación",
    links: [
      { href: "/admin/cursos", label: "Cursos", icon: "courses", roles: ["ADMIN", "MARKETING", "VENTAS", "LECTURA"] },
      { href: "/admin/certificados", label: "Envíos a Finance", icon: "finance", roles: ["ADMIN", "VENTAS", "LECTURA"] },
    ],
  },
  {
    label: "Automatización",
    links: [
      { href: "/admin/mensajes", label: "Mensajes", icon: "messages", roles: ["ADMIN", "MARKETING", "VENTAS"] },
      { href: "/admin/redes", label: "Redes", icon: "social", roles: ["ADMIN", "MARKETING"] },
    ],
  },
  {
    label: "Administración",
    links: [
      { href: "/admin/usuarios", label: "Usuarios", icon: "users", roles: ["ADMIN"] },
      { href: "/admin/auditoria", label: "Auditoría", icon: "audit", roles: ["ADMIN"] },
    ],
  },
];

const pageNames = navigation.flatMap((group) => group.links);

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState("LECTURA");
  const [name, setName] = useState("Usuario");
  const [legacy, setLegacy] = useState(false);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data) {
          setRole(data.role);
          setName(data.name);
          setLegacy(Boolean(data.legacy));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (pathname) setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLElement>("button")?.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      menuButton?.focus();
    };
  }, [open]);

  const currentPage = useMemo(() => {
    return pageNames
      .filter((item) => pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? "Administración";
  }, [pathname]);

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "RA";

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <>
      <aside ref={sidebarRef} id="admin-menu" className={`admin-sidebar ${open ? "is-open" : ""}`} aria-label="Navegación administrativa">
        <button className="admin-sidebar-close" type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)}>
          <AdminIcon name="close" size={20} />
        </button>
        <Link className="admin-sidebar-brand" href="/admin" onClick={() => setOpen(false)}>
          <span className="admin-sidebar-brand-row">
            <Image src="/crm-logo.png" alt="" width={64} height={64} priority />
            <strong>R.A. Training</strong>
          </span>
          <span>Panel administrativo</span>
        </Link>

        <nav className="admin-sidebar-nav">
          {navigation.map((group) => {
            const allowedLinks = group.links.filter((link) => link.roles.includes(role));
            if (!allowedLinks.length) return null;
            return (
              <section className="admin-nav-group" key={group.label} aria-labelledby={`nav-${group.label.replaceAll(" ", "-")}`}>
                <h2 id={`nav-${group.label.replaceAll(" ", "-")}`}>{group.label}</h2>
                {allowedLinks.map((link) => {
                  const isActive = pathname === link.href || (link.href !== "/admin" && pathname.startsWith(`${link.href}/`));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={isActive ? "active" : ""}
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <AdminIcon name={link.icon} size={19} />
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          <AdminIcon name="secure" size={18} />
          <span><strong>{legacy ? "Acceso heredado temporal" : "Sesión protegida"}</strong><small>{legacy ? "Crea y usa una cuenta individual" : "Acceso según tu perfil"}</small></span>
        </div>
      </aside>

      {open ? <button className="admin-sidebar-backdrop" type="button" aria-label="Cerrar menú" onClick={() => setOpen(false)} /> : null}

      <header className="admin-topbar">
        <div className="admin-topbar-start">
          <button
            ref={menuButtonRef}
            className="admin-menu-toggle"
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="admin-menu"
            aria-label={open ? "Cerrar menú" : "Abrir menú"}
          >
            <AdminIcon name={open ? "close" : "menu"} size={22} />
          </button>
          <div className="admin-current-page">
            <span>Panel administrativo</span>
            <strong>{currentPage}</strong>
          </div>
        </div>

        <div className="admin-topbar-actions">
          <a className="admin-site-link" href="https://ra-training.com/courses-1/" target="_blank" rel="noopener noreferrer" aria-label="Ver catálogo oficial de R.A. Training">
            <AdminIcon name="external" size={17} />
            <span>Ver catálogo oficial</span>
          </a>
          <details className="admin-user-menu">
            <summary aria-label="Abrir menú de usuario">
              <span className="admin-avatar" aria-hidden="true">{initials}</span>
              <span className="admin-user-copy"><strong>{name}</strong><small>{presentAdminValue(role)}</small></span>
              <AdminIcon name="chevron" size={16} />
            </summary>
            <div className="admin-user-popover">
              <div><strong>{name}</strong><span>{presentAdminValue(role)}</span></div>
              <button type="button" onClick={logout} disabled={loggingOut}>
                <AdminIcon name="logout" size={17} />
                {loggingOut ? "Cerrando…" : "Cerrar sesión"}
              </button>
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
