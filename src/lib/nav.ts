// SOLU global navigation. Exactly 8 modules, in this order, never more.
// Sections inside a module are tabs at the top of the content, so the
// hierarchy is unequivocal: sidebar = module, tabs = section.

export type ModuleKey = "midia" | "mercado" | "comercial" | "operaciones" | "administracion" | "proyectos" | "equipo" | "gerencia";

export type NavTab = { href: string; es: string; en: string; managerOnly?: boolean; adminOnly?: boolean };
export type NavModule = { key: ModuleKey; es: string; en: string; match: string[]; tabs: NavTab[] };

export const MODULES: NavModule[] = [
  {
    key: "midia", es: "MI DÍA", en: "MY DAY", match: ["/mi-dia", "/mi-plan", "/tasks", "/comunicacion", "/email"],
    tabs: [
      { href: "/mi-dia", es: "Hoy", en: "Today" },
      { href: "/mi-plan", es: "Mi Plan", en: "My Plan" },
      { href: "/tasks", es: "Pendientes", en: "To-dos" },
      { href: "/comunicacion", es: "Comunicación", en: "Communication" },
      { href: "/email", es: "Correo", en: "Email" },
    ],
  },
  {
    key: "mercado", es: "MERCADO", en: "MARKET", match: ["/accounts", "/contacts", "/suppliers"],
    tabs: [
      { href: "/accounts", es: "Clientes", en: "Customers" },
      { href: "/contacts", es: "Contactos", en: "Contacts" },
      { href: "/suppliers", es: "Proveedores", en: "Suppliers" },
    ],
  },
  {
    key: "comercial", es: "COMERCIAL", en: "COMMERCIAL", match: ["/deals", "/cotizaciones"],
    tabs: [
      { href: "/deals", es: "Journeys", en: "Journeys" },
      { href: "/cotizaciones", es: "Futuro comercial", en: "Commercial future" },
    ],
  },
  {
    key: "operaciones", es: "OPERACIONES", en: "OPERATIONS", match: ["/operaciones", "/compras"],
    tabs: [
      { href: "/compras", es: "Compras", en: "Purchasing" },
      { href: "/operaciones/sin-despachar", es: "Sin despachar", en: "Unshipped" },
      { href: "/operaciones/remisiones", es: "Remisiones", en: "Delivery notes" },
      { href: "/operaciones/por-facturar", es: "Entregado sin facturar", en: "Delivered, not invoiced" },
    ],
  },
  {
    key: "administracion", es: "ADMINISTRACIÓN", en: "ADMINISTRATION", match: ["/administracion"],
    tabs: [
      { href: "/administracion/cobrar", es: "Cuentas por cobrar", en: "Receivables" },
      { href: "/administracion/pagos-recibidos", es: "Pagos recibidos", en: "Payments received" },
      { href: "/administracion/pagos-proveedores", es: "Pagos a proveedores", en: "Supplier payments" },
      { href: "/administracion/pagos-exterior", es: "Pagos al exterior", en: "Foreign payments" },
      { href: "/administracion/cupos", es: "Cupos de crédito", en: "Credit limits" },
    ],
  },
  { key: "proyectos", es: "PROYECTOS", en: "PROJECTS", match: ["/proyectos"], tabs: [{ href: "/proyectos", es: "Proyectos", en: "Projects" }] },
  {
    key: "equipo", es: "EQUIPO", en: "TEAM", match: ["/admin", "/profile"],
    tabs: [
      { href: "/admin/users", es: "Personas y datos", en: "People & data", adminOnly: true },
      { href: "/profile", es: "Mi perfil", en: "My profile" },
    ],
  },
  {
    key: "gerencia", es: "GERENCIA/INSIGHTS", en: "MANAGEMENT/INSIGHTS", match: ["/gerencia"],
    tabs: [
      { href: "/gerencia", es: "Reporting", en: "Reporting", managerOnly: true },
      { href: "/gerencia/comisiones", es: "Comisiones", en: "Commissions" },
    ],
  },
];

export function moduleFor(path: string) {
  return MODULES.find((m) => m.match.some((p) => path === p || path.startsWith(p + "/")));
}
