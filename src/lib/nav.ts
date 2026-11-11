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
  // Administración (Módulo 14)
  hoy: { es: "Hoy", en: "Today" },
  recursos: { es: "Recursos", en: "Resources" },
  cierre: { es: "Cierre", en: "Close" },
  // Gerencia (Módulo 15)
  direccion: { es: "Dirección", en: "Direction" },
  revision: { es: "Revisión", en: "Review" },
  gobierno: { es: "Gobierno", en: "Governance" },
} as const;
export type NavModule = { key: ModuleKey; es: string; en: string; match: string[]; tabs: NavTab[] };

const FIN = ["GERENCIA", "DIRECTOR_COMERCIAL", "FINANZAS", "ADMINISTRACION"];

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
    // Módulo 14: many sections, shown one group at a time. FIN = the roles that run the money side.
    tabs: [
      { href: "/administracion", es: "Inicio", en: "Home", group: "hoy" },
      { href: "/administracion/exposicion", es: "Exposición de recursos", en: "Resource exposure", group: "hoy", roles: FIN },
      { href: "/administracion/tesoreria", es: "Tesorería", en: "Treasury", group: "dinero", roles: FIN },
      { href: "/administracion/cobrar", es: "Cuentas por cobrar", en: "Receivables", group: "dinero" },
      { href: "/administracion/pagos-recibidos", es: "Pagos recibidos", en: "Payments received", group: "dinero" },
      { href: "/administracion/banco", es: "Banco", en: "Bank", group: "dinero" },
      { href: "/administracion/pagar", es: "Cuentas por pagar", en: "Payables", group: "dinero", roles: [...FIN, "NEGOCIADOR_OPERATIVO"] },
      { href: "/administracion/pagos-proveedores", es: "Pagos a proveedores", en: "Supplier payments", group: "dinero" },
      { href: "/administracion/pagos-exterior", es: "Pagos al exterior", en: "Foreign payments", group: "dinero" },
      { href: "/administracion/cupos", es: "Cupos de crédito", en: "Credit limits", group: "dinero" },
      { href: "/administracion/presupuesto", es: "Presupuesto", en: "Budget", group: "recursos" },
      { href: "/administracion/compras-internas", es: "Compras internas", en: "Internal purchases", group: "recursos" },
      { href: "/administracion/activos", es: "Activos", en: "Assets", group: "recursos" },
      { href: "/administracion/obligaciones", es: "Contratos y obligaciones", en: "Contracts and obligations", group: "recursos" },
      { href: "/administracion/personas", es: "Personas", en: "People", group: "recursos" },
      { href: "/administracion/autoridad", es: "Autoridad prestada", en: "Delegated authority", group: "recursos" },
      { href: "/administracion/cierre", es: "Cierre y comisiones", en: "Close and commissions", group: "cierre" },
      { href: "/administracion/economia", es: "Eságara real", en: "Real Eságara", group: "cierre" },
      { href: "/administracion/contabilidad", es: "Contabilidad", en: "Accounting", group: "cierre", roles: FIN },
      { href: "/administracion/politicas", es: "Políticas", en: "Policies", group: "ajustes" },
      { href: "/administracion/eventos", es: "Eventos", en: "Events", group: "ajustes", roles: FIN },
      { href: "/administracion/historial", es: "Historial de cambios", en: "Change history", group: "ajustes", managerOnly: true },
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
    // Módulo 15: Home first; what is not for everyone is hidden by role (§13). Asking Gerencia for a decision,
    // the company identity and the function charters are open to every person.
    tabs: [
      { href: "/gerencia", es: "Inicio", en: "Home", group: "hoy", managerOnly: true },
      { href: "/gerencia/junta", es: "Vista de Junta", en: "Board view", group: "hoy", roles: ["JUNTA", "GERENCIA"] },
      { href: "/gerencia/decisiones", es: "Decisiones", en: "Decisions", group: "hoy" },
      { href: "/gerencia/cierre", es: "Cierre ejecutivo", en: "Executive close", group: "hoy", managerOnly: true },
      { href: "/gerencia/futuro", es: "Puente al futuro", en: "Future bridge", group: "direccion", managerOnly: true },
      { href: "/gerencia/prioridades", es: "Prioridades estratégicas", en: "Strategic priorities", group: "direccion", managerOnly: true },
      { href: "/gerencia/cuentas", es: "Cuentas estratégicas", en: "Strategic accounts", group: "direccion", managerOnly: true },
      { href: "/gerencia/escenarios", es: "Escenarios", en: "Scenarios", group: "direccion", managerOnly: true },
      { href: "/gerencia/revisiones", es: "Revisión por función", en: "Functional review", group: "revision", managerOnly: true },
      { href: "/gerencia/insights", es: "Insights", en: "Insights", group: "revision", managerOnly: true },
      { href: "/gerencia/sistema", es: "Desempeño del sistema", en: "System performance", group: "revision", managerOnly: true },
      { href: "/gerencia/personas", es: "Personas y capacidad", en: "People and capacity", group: "revision", adminOnly: true },
      { href: "/gerencia/identidad", es: "Identidad", en: "Identity", group: "gobierno" },
      { href: "/gerencia/funciones", es: "Funciones y roles", en: "Functions and roles", group: "gobierno" },
      { href: "/gerencia/politicas", es: "Políticas y autoridad", en: "Policies and authority", group: "gobierno", managerOnly: true },
      { href: "/gerencia/comisiones", es: "Comisiones", en: "Commissions", group: "dinero" },
      { href: "/gerencia/liquidacion", es: "Liquidación", en: "Settlement", group: "dinero" },
      { href: "/gerencia/rentabilidad", es: "Rentabilidad", en: "Profitability", group: "dinero" },
    ],
  },
];

export function moduleFor(path: string) {
  return MODULES.find((m) => m.match.some((p) => path === p || path.startsWith(p + "/")));
}
