import Link from "next/link";

const links = [
  { href: "/admin", label: "Resumen" },
  { href: "/admin/leads", label: "Leads" },
  { href: "/admin/mensajes", label: "Nurture" },
  { href: "/admin/certificados", label: "Certificados" },
  { href: "/admin/redes", label: "Redes" },
];

export function AdminNav({ active }: { active: string }) {
  return (
    <nav className="admin-nav">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={l.href === active ? "active" : ""}>
          {l.label}
        </Link>
      ))}
      <span className="spacer" />
      <Link href="/">Ver sitio ↗</Link>
    </nav>
  );
}
