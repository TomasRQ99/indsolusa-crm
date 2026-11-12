// Every rule SOLU applies with numbers, by the key of its versioned setting: its name, who changes it and where.
// One list, read by Administración → Políticas (Módulo 14 §2L) and by Gerencia → Políticas y autoridad (Módulo 15 §8).

export type PolicyEntry = { key: string; es: string; en: string; whoEs: string; whoEn: string; href: string };
export const POLICY_REGISTER: PolicyEntry[] = [
  { key: "purchasePolicy", es: "Autoridad de compras y de pagos a proveedores", en: "Purchase and supplier-payment authority", whoEs: "Gerencia", whoEn: "Management", href: "/compras/requerimientos#politica" },
  { key: "adminPolicy", es: "Administración: obligaciones, materialidad, tolerancia de facturas, autoridad prestada", en: "Administration: obligations, materiality, invoice tolerance, delegated authority", whoEs: "Gerencia", whoEn: "Management", href: "/administracion/politicas#admin" },
  { key: "gerenciaPolicy", es: "Gerencia: qué interrumpe, concentración, excepciones repetidas, quién publica identidad y funciones", en: "Management: what interrupts, concentration, repeated exceptions, who publishes identity and functions", whoEs: "Gerencia", whoEn: "Management", href: "/gerencia/politicas#gerencia" },
  { key: "teamPolicy", es: "Equipo: duración del ciclo de desarrollo, puntos de control, prioridades por dimensión y dimensiones de carácter", en: "Team: development cycle length, checkpoints, priorities per dimension and character dimensions", whoEs: "Gerencia", whoEn: "Management", href: "/equipo/organizacion#politica" },
  { key: "payRules", es: "Crédito: cómo se lee el comportamiento de pago", en: "Credit: how payment behaviour is read", whoEs: "Finanzas o Gerencia", whoEn: "Finance or Management", href: "/administracion/cupos" },
  { key: "cashPolicy", es: "Alertas de dinero detenido y edades de cartera", en: "Stopped-money alerts and receivable ageing", whoEs: "Finanzas o Gerencia", whoEn: "Finance or Management", href: "/comercial/fugas#politica" },
  { key: "comPolicy", es: "Umbral de Eságara baja y quién aprueba la excepción", en: "Low-Eságara threshold and who approves the exception", whoEs: "Gerencia", whoEn: "Management", href: "/comercial/esagara" },
  { key: "esagaraPolicy", es: "Cierre económico de un Journey", en: "Economic close of a Journey", whoEs: "Gerencia", whoEn: "Management", href: "/administracion/economia" },
  { key: "financeRate", es: "Costo del dinero", en: "Cost of money", whoEs: "Propuesta + Gerencia", whoEn: "Proposal + Management", href: "/profile/rentabilidad" },
  { key: "opsPolicy", es: "Operaciones: tolerancias de flete, courier o carga, inventario", en: "Operations: freight tolerances, courier or cargo, stock", whoEs: "Gerencia", whoEn: "Management", href: "/operaciones/configuracion" },
  { key: "authPolicy", es: "Rangos de autorización por nivel", en: "Authorisation ranges by level", whoEs: "Gerencia", whoEn: "Management", href: "/profile/autorizaciones" },
  { key: "focusPolicy", es: "Foco de alto valor", en: "High-value focus", whoEs: "Gerencia o Dirección", whoEn: "Management or Direction", href: "/comercial/foco" },
  { key: "contactLine", es: "Línea de comunicaciones: rangos de tiempo sin contacto", en: "Communication line: time ranges without contact", whoEs: "Gerencia o Dirección", whoEn: "Management or Direction", href: "/comercial/comunicaciones#rangos" },
  { key: "econThresholds", es: "Señales económicas de Mercado", en: "Market economic signals", whoEs: "Gerencia", whoEn: "Management", href: "/mercado/fuentes" },
];
