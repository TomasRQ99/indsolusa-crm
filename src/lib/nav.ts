// SOLU global navigation. Nine modules, in this order (the ninth, Informes, by user decision I-01 of 2026-11-11).
// Sections inside a module are tabs at the top of the content, so the
// hierarchy is unequivocal: sidebar = module, tabs = section.

export type ModuleKey = "midia" | "mercado" | "comercial" | "operaciones" | "administracion" | "proyectos" | "equipo" | "informes" | "gerencia";

/** `group`: when a module has many sections, tabs are shown one group at a time (group row on top, its tabs below). */
export type NavTab = { href: string; es: string; en: string; managerOnly?: boolean; adminOnly?: boolean; roles?: string[]; group?: keyof typeof NAV_GROUPS };
export const NAV_GROUPS = {
  negocios: { es: "Negocios", en: "Business" },
  dinero: { es: "Dinero", en: "Money" },
  trabajo: { es: "Mi trabajo", en: "My work" },
  ajustes: { es: "Configuración", en: "Setup" },
} as const;
export type NavModule = { key: ModuleKey; es: string; en: string; match: string[]; tabs: NavTab[] };

export const MODULES: NavModule[] = [
  {
    key: "midia", es: "MI DÍA", en: "MY DAY", match: ["/mi-dia", "/mi-plan", "/tasks", "/comunicacion", "/email", "/correo"],
    tabs: [
      { href: "/mi-dia", es: "Hoy", en: "Today" },
      { href: "/mi-plan", es: "Mi Plan", en: "My Plan" },
      { href: "/tasks", es: "Pendientes", en: "To-dos" },
      { href: "/comunicacion", es: "Comunicación", en: "Communication" },
      { href: "/email", es: "Correo", en: "Email" },
      { href: "/correo/respuestas", es: "Respuestas", en: "Replies" },
    ],
  },
  {
    key: "mercado", es: "MERCADO", en: "MARKET", match: ["/mercado", "/accounts", "/contacts", "/suppliers", "/localizar", "/productos"],
    tabs: [
      { href: "/mercado", es: "Explorar", en: "Explore" },
      { href: "/mercado/economia", es: "Economía", en: "Economy" },
      { href: "/mercado/fuentes", es: "Fuentes", en: "Sources", roles: ["GERENCIA", "DIRECTOR_COMERCIAL", "MARKETING"] },
      { href: "/accounts", es: "Clientes", en: "Customers" },
      { href: "/contacts", es: "Contactos", en: "Contacts" },
      { href: "/suppliers", es: "Proveedores", en: "Suppliers" },
      { href: "/localizar", es: "Localizar repuestos", en: "Find parts" },
      { href: "/productos", es: "Productos", en: "Products" },
    ],
  },
  {
    key: "comercial", es: "COMERCIAL", en: "COMMERCIAL", match: ["/deals", "/cotizaciones", "/comercial", "/visitas"],
    tabs: [
      { href: "/deals", es: "Journeys", en: "Journeys", group: "negocios" },
      { href: "/cotizaciones", es: "Futuro comercial", en: "Commercial future", group: "negocios" },
      { href: "/comercial/foco", es: "Foco de alto valor", en: "High-value focus", group: "negocios" },
      { href: "/visitas", es: "Visitas", en: "Visits", group: "negocios" },
      { href: "/comercial/dinero", es: "Dinero por mover", en: "Money to move", group: "dinero" },
      { href: "/comercial/fugas", es: "Fugas de caja", en: "Cash leakage", group: "dinero" },
      { href: "/comercial/esagara", es: "Excepciones de Eságara", en: "Eságara exceptions", group: "dinero" },
      { href: "/comercial/metas", es: "Mis metas", en: "My goals", group: "trabajo" },
      { href: "/comercial/mejora", es: "Mi mejora", en: "My improvement", group: "trabajo" },
      { href: "/comercial/cierres", es: "Cierres", en: "Closes", group: "trabajo" },
      { href: "/comercial/cobertura", es: "Cobertura", en: "Coverage", group: "trabajo" },
      { href: "/comercial/valor", es: "Atributos de valor", en: "Value attributes", group: "ajustes" },
      { href: "/comercial/empresas", es: "Empresas que venden", en: "Selling companies", group: "ajustes" },
    ],
  },
  {
    key: "operaciones", es: "OPERACIONES", en: "OPERATIONS", match: ["/operaciones", "/compras", "/logistica"],
    tabs: [
      { href: "/operaciones", es: "Inicio", en: "Home" },
      { href: "/operaciones/compromisos", es: "Alto valor", en: "High value" },
      { href: "/compras/requerimientos", es: "Requerimientos", en: "Requirements" },
      { href: "/compras", es: "Compras", en: "Purchasing" },
      { href: "/logistica", es: "Envíos", en: "Shipments" },
      { href: "/operaciones/inventario", es: "Inventario", en: "Stock" },
      { href: "/operaciones/despachos", es: "Despachos", en: "Dispatch" },
      { href: "/operaciones/sin-despachar", es: "Sin despachar", en: "Unshipped" },
      { href: "/operaciones/remisiones", es: "Remisiones", en: "Delivery notes" },
      { href: "/operaciones/por-facturar", es: "Entregado sin facturar", en: "Delivered, not invoiced" },
      { href: "/operaciones/transportadores", es: "Transportadores", en: "Carriers" },
      { href: "/operaciones/garantias", es: "Garantías", en: "Warranties" },
      { href: "/operaciones/experiencias", es: "Experiencias", en: "Experiences" },
      { href: "/operaciones/metricas", es: "Métricas", en: "Metrics" },
      { href: "/operaciones/configuracion", es: "Configuración", en: "Settings" },
    ],
  },
  {
    key: "administracion", es: "ADMINISTRACIÓN", en: "ADMINISTRATION", match: ["/administracion"],
    tabs: [
      { href: "/administracion/cobrar", es: "Cuentas por cobrar", en: "Receivables" },
      { href: "/administracion/pagos-recibidos", es: "Pagos recibidos", en: "Payments received" },
      { href: "/administracion/banco", es: "Banco", en: "Bank" },
      { href: "/administracion/pagos-proveedores", es: "Pagos a proveedores", en: "Supplier payments" },
      { href: "/administracion/pagos-exterior", es: "Pagos al exterior", en: "Foreign payments" },
      { href: "/administracion/cierre", es: "Cierre y comisiones", en: "Close and commissions" },
      { href: "/administracion/economia", es: "Eságara real", en: "Real Eságara" },
      { href: "/administracion/cupos", es: "Cupos de crédito", en: "Credit limits" },
      { href: "/administracion/historial", es: "Historial de cambios", en: "Change history", managerOnly: true },
    ],
  },
  { key: "proyectos", es: "PROYECTOS", en: "PROJECTS", match: ["/proyectos"], tabs: [{ href: "/proyectos", es: "Proyectos", en: "Projects" }] },
  {
    key: "equipo", es: "EQUIPO", en: "TEAM", match: ["/admin", "/profile"],
    tabs: [
      { href: "/admin/users", es: "Personas y datos", en: "People & data", adminOnly: true },
      { href: "/admin/trabajos", es: "Trabajos en segundo plano", en: "Background work", adminOnly: true },
      { href: "/profile", es: "Mi perfil", en: "My profile" },
    ],
  },
  {
    key: "informes", es: "INFORMES", en: "REPORTS", match: ["/informes"],
    tabs: [
      { href: "/informes", es: "Mi desempeño", en: "My performance" },
      { href: "/informes/equipo", es: "Equipo", en: "Team" },
      { href: "/informes/pulso", es: "Pulso del negocio", en: "Business pulse", roles: ["GERENCIA", "DIRECTOR_COMERCIAL", "FINANZAS", "ADMINISTRACION"] },
      { href: "/informes/futuro", es: "Pulso del futuro", en: "Future pulse", roles: ["GERENCIA", "DIRECTOR_COMERCIAL", "FINANZAS", "ADMINISTRACION"] },
      { href: "/informes/funcion", es: "Función Comercial", en: "Commercial function", roles: ["GERENCIA", "DIRECTOR_COMERCIAL", "FINANZAS", "ADMINISTRACION"] },
      { href: "/informes/administracion", es: "Administración", en: "Administration", roles: ["GERENCIA", "DIRECTOR_COMERCIAL", "FINANZAS", "ADMINISTRACION"] },
      { href: "/informes/constructor", es: "Constructor", en: "Builder" },
      { href: "/informes/metricas", es: "Diccionario de métricas", en: "Metric dictionary" },
    ],
  },
  {
    key: "gerencia", es: "GERENCIA", en: "MANAGEMENT", match: ["/gerencia"],
    tabs: [
      { href: "/gerencia", es: "Insights", en: "Insights", managerOnly: true },
      { href: "/gerencia/comisiones", es: "Comisiones", en: "Commissions" },
      { href: "/gerencia/liquidacion", es: "Liquidación", en: "Settlement" },
      { href: "/gerencia/rentabilidad", es: "Rentabilidad", en: "Profitability" },
    ],
  },
];

export function moduleFor(path: string) {
  return MODULES.find((m) => m.match.some((p) => path === p || path.startsWith(p + "/")));
}
