import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { canManageAll } from "@/lib/permissions";
import { NavLinks, type NavSection } from "@/components/NavLinks";
import { logout } from "../login/actions";
import { setLanguage } from "./profile/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t, lang } = makeI18n(user.lang);
  const manager = canManageAll(user);
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Frozen global navigation: MI DÍA | MERCADO | COMERCIAL | OPERACIONES | ADMINISTRACIÓN | EQUIPO | GERENCIA
  const sections: NavSection[] = [
    {
      label: t("Mi día", "My day"),
      links: [
        { href: "/mi-dia", label: t("Mi Día", "My Day") },
        { href: "/mi-plan", label: t("Mi Plan", "My Plan") },
        { href: "/tasks", label: t("Pendientes", "To-dos") },
        { href: "/email", label: t("Correo", "Email") },
      ],
    },
    {
      label: t("Mercado", "Market"),
      links: [
        { href: "/accounts", label: t("Clientes", "Customers") },
        { href: "/contacts", label: t("Contactos", "Contacts") },
        { href: "/suppliers", label: t("Proveedores", "Suppliers") },
      ],
    },
    {
      label: t("Comercial", "Commercial"),
      links: [{ href: "/deals", label: t("Journeys y negocios", "Journeys & deals") }],
    },
    {
      label: t("Operaciones", "Operations"),
      links: [
        { href: "/operaciones/sin-despachar", label: t("Órdenes sin despachar", "Unshipped orders") },
        { href: "/operaciones/remisiones", label: t("Remisiones", "Delivery notes") },
        { href: "/operaciones/por-facturar", label: t("Entregado sin facturar", "Delivered, not invoiced") },
      ],
    },
    {
      label: t("Administración", "Administration"),
      links: [
        { href: "/administracion/cobrar", label: t("Cuentas por cobrar", "Receivables") },
        { href: "/administracion/pagos-recibidos", label: t("Pagos recibidos", "Payments received") },
        { href: "/administracion/pagos-proveedores", label: t("Pagos a proveedores", "Supplier payments") },
        { href: "/administracion/pagos-exterior", label: t("Informe pagos al exterior", "Foreign payments report") },
        { href: "/administracion/cupos", label: t("Cupos de crédito", "Credit limits") },
      ],
    },
    {
      label: t("Equipo", "Team"),
      links: [
        { href: "/profile", label: t("Mi perfil", "My profile") },
        ...(user.role === "ADMIN" ? [{ href: "/admin/users", label: t("Usuarios y datos", "Users & data") }] : []),
      ],
    },
    {
      label: t("Gerencia", "Management"),
      links: [
        ...(manager ? [{ href: "/gerencia", label: t("Reporting", "Reporting") }] : []),
        { href: "/gerencia/comisiones", label: t("Comisiones", "Commissions") },
      ],
    },
  ];

  return (
    <>
      <header className="topbar">
        <Link href="/mi-dia" className="logo" style={{ textDecoration: "none" }}>
          SOLU<small>Industry Solutions</small>
        </Link>
        <form className="search" action="/buscar">
          <input name="q" type="search" placeholder={t("Buscar: cliente, Journey, OC, factura, proveedor…", "Search: customer, Journey, PO, invoice, supplier…")} aria-label={t("Buscar", "Search")} />
        </form>
        <div className="grow" />
        <form action={setLanguage} className="lang" aria-label={t("Idioma", "Language")}>
          <button type="submit" name="lang" value="ES" className={lang === "ES" ? "on" : undefined}>ES</button>
          <button type="submit" name="lang" value="EN" className={lang === "EN" ? "on" : undefined}>EN</button>
        </form>
        <div className="me">
          <Link href="/profile" className="avatar" title={user.name} style={{ textDecoration: "none" }}>{initials}</Link>
          <form action={logout}>
            <button className="link small" type="submit">{t("Salir", "Sign out")}</button>
          </form>
        </div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <NavLinks sections={sections} />
        </aside>
        <main className="content">{children}</main>
      </div>
    </>
  );
}
