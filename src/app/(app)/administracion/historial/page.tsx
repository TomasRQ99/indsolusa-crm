import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";

// #4 Audit trail: what changed in money, bank data, roles, commitments and documents — who, when,
// before and after. Read-only. It answers "what happened to this record?", not "what did a person do"
// (no counts or rankings of people).

type Ch = Record<string, [string | number | boolean | null, string | number | boolean | null]>;

const MODELS: Record<string, { es: string; en: string; href?: (id: string) => string }> = {
  Invoice: { es: "Factura", en: "Invoice", href: (id) => `/administracion/cobrar?f=${id}` },
  // Módulo 14 · Administración
  CashBalance: { es: "Saldo bancario confirmado", en: "Confirmed bank balance", href: () => "/administracion/tesoreria#cuentas" },
  CashReserve: { es: "Dinero restringido o reservado", en: "Restricted or reserved money", href: () => "/administracion/tesoreria#reservas" },
  CashPlanItem: { es: "Movimiento del plan de caja", en: "Cash plan movement", href: () => "/administracion/tesoreria#plan" },
  SupplierInvoice: { es: "Factura de proveedor", en: "Supplier invoice", href: (id) => `/administracion/pagar#f-${id}` },
  Budget: { es: "Presupuesto", en: "Budget", href: (id) => `/administracion/presupuesto#b-${id}` },
  BudgetEntry: { es: "Compromiso o gasto de presupuesto", en: "Budget commitment or spend" },
  InternalPurchase: { es: "Compra interna", en: "Internal purchase", href: (id) => `/administracion/compras-internas/${id}` },
  Asset: { es: "Activo", en: "Asset", href: (id) => `/administracion/activos/${id}` },
  AssetEvent: { es: "Historia de un activo", en: "Asset history" },
  Obligation: { es: "Contrato u obligación", en: "Contract or obligation", href: (id) => `/administracion/obligaciones#o-${id}` },
  PersonAdmin: { es: "Datos del vínculo de una persona (sin valores)", en: "A person's bond data (no values)" },
  PersonCompensation: { es: "Remuneración (sin el valor)", en: "Pay (without the amount)" },
  PersonRoleAssignment: { es: "Cargo formal de una persona", en: "A person's formal position" },
  AbsenceRecord: { es: "Ausencia", en: "Absence" },
  DelegatedAuthority: { es: "Autoridad prestada", en: "Delegated authority", href: () => "/administracion/autoridad" },
  SupportGap: { es: "Soporte que la empresa debe", en: "Support the company owes" },
  AccountingExport: { es: "Archivo descargado para contabilidad", en: "File downloaded for accounting", href: () => "/administracion/contabilidad#registro" },
  ManagementDecision: { es: "Decisión de Gerencia", en: "Management decision", href: (id) => `/gerencia/decisiones/${id}` },
  ManagementDecisionReview: { es: "Revisión de una decisión contra lo que pasó", en: "Review of a decision against what happened" },
  StrategicPriority: { es: "Prioridad estratégica", en: "Strategic priority", href: (id) => `/gerencia/prioridades?ver=todas#p-${id}` },
  StrategicPriorityLink: { es: "Vínculo de una prioridad estratégica", en: "Link of a strategic priority" },
  StrategicPriorityReview: { es: "Revisión de una prioridad estratégica", en: "Review of a strategic priority" },
  Scenario: { es: "Escenario", en: "Scenario", href: (id) => `/gerencia/escenarios?ver=todos#s-${id}` },
  StrategicAccount: { es: "Cuenta estratégica", en: "Strategic account", href: (id) => `/gerencia/cuentas#a-${id}` },
  CompanyIdentity: { es: "Identidad de la compañía", en: "Company identity", href: () => "/gerencia/identidad" },
  FunctionCharter: { es: "Carta de función", en: "Function charter", href: () => "/gerencia/funciones" },
  CustomerPayment: { es: "Pago recibido", en: "Payment received", href: () => "/administracion/pagos-recibidos" },
  PaymentApplication: { es: "Asignación de pago", en: "Payment allocation" },
  SupplierPayment: { es: "Pago a proveedor", en: "Supplier payment", href: (id) => `/administracion/pagos-proveedores/${id}` },
  PaymentExecution: { es: "Ejecución de pago", en: "Payment execution" },
  PaymentRequirement: { es: "Hito de pago", en: "Payment milestone" },
  SupplierPO: { es: "Supplier PO", en: "Supplier PO", href: (id) => `/compras/${id}` },
  SupplierPOLine: { es: "Línea de Supplier PO", en: "Supplier PO line" },
  Supplier: { es: "Proveedor (datos bancarios y términos)", en: "Supplier (bank data and terms)", href: (id) => `/suppliers/${id}` },
  Quote: { es: "Cotización", en: "Quote", href: (id) => `/cotizaciones/${id}` },
  QuoteLine: { es: "Línea de cotización", en: "Quote line" },
  CustomerPO: { es: "OC del cliente", en: "Customer PO", href: (id) => `/po/${id}` },
  PoAcceptance: { es: "Aceptación de OC", en: "PO acceptance" },
  PoResolution: { es: "Resolución de OC", en: "PO resolution" },
  Deal: { es: "Journey (valores y estado)", en: "Journey (amounts and state)", href: (id) => `/deals/${id}` },
  DealItem: { es: "Producto del Journey", en: "Journey product" },
  Account: { es: "Cliente (crédito y facturación)", en: "Customer (credit and billing)", href: (id) => `/accounts/${id}` },
  User: { es: "Persona (rol y acceso)", en: "Person (role and access)" },
  CommissionPolicy: { es: "Política de comisiones", en: "Commission policy" },
  CommissionEntry: { es: "Comisión", en: "Commission" },
  Exploration: { es: "Exploración de mercado", en: "Market exploration", href: (id) => `/mercado/exploraciones/${id}` },
  MarketSignal: { es: "Señal de mercado", en: "Market signal" },
  KnowledgeGap: { es: "Pregunta abierta", en: "Open question" },
  WhiteSpace: { es: "Espacio sin explorar", en: "White space" },
  Plant: { es: "Planta", en: "Plant" },
  FutureOpportunity: { es: "Oportunidad futura", en: "Future opportunity" },
  AccountAlias: { es: "Otro nombre de la empresa", en: "Company alias" },
  AccountInsight: { es: "Cómo funciona la empresa", en: "How the account works" },
  InstalledAsset: { es: "Equipo instalado", en: "Installed equipment" },
  ImpactProfile: { es: "Impacto de paro", en: "Downtime impact" },
  Employment: { es: "Rol de una persona", en: "Person's role" },
};
const GROUPS: { key: string; es: string; en: string; models: string[] }[] = [
  { key: "cobro", es: "Facturas y cobros", en: "Invoices and collections", models: ["Invoice", "CustomerPayment", "PaymentApplication"] },
  { key: "pagos", es: "Pagos a proveedores", en: "Supplier payments", models: ["SupplierPayment", "PaymentExecution", "PaymentRequirement", "SupplierPO", "SupplierPOLine"] },
  { key: "banco", es: "Datos bancarios de proveedores", en: "Supplier bank data", models: ["Supplier"] },
  { key: "venta", es: "Cotizaciones, OC y Journeys", en: "Quotes, POs and Journeys", models: ["Quote", "QuoteLine", "CustomerPO", "PoAcceptance", "PoResolution", "Deal", "DealItem"] },
  { key: "credito", es: "Crédito de clientes", en: "Customer credit", models: ["Account"] },
  { key: "acceso", es: "Roles, accesos y comisiones", en: "Roles, access and commissions", models: ["User", "CommissionPolicy", "CommissionEntry"] },
  { key: "mercado", es: "Mercado", en: "Market", models: ["Exploration", "MarketSignal", "KnowledgeGap", "WhiteSpace", "Plant", "FutureOpportunity", "AccountAlias", "AccountInsight", "InstalledAsset", "ImpactProfile", "Employment"] },
];
const FIELDS: Record<string, [string, string]> = {
  amount: ["Monto", "Amount"], amountUsd: ["Monto USD", "Amount USD"], currency: ["Moneda", "Currency"], status: ["Estado", "Status"], state: ["Estado", "State"], stage: ["Etapa", "Stage"],
  unitPrice: ["Precio unitario", "Unit price"], unitCost: ["Costo unitario", "Unit cost"], qty: ["Cantidad", "Quantity"], supplierCost: ["Costo proveedor", "Supplier cost"], freightCost: ["Flete", "Freight"], otherCosts: ["Otros costos", "Other costs"],
  fxRate: ["Tasa de cambio", "Exchange rate"], protSale: ["Venta protegida", "Protected sale"], protCost: ["Costo protegido", "Protected cost"], protEsagra: ["Eságara protegida", "Protected eságara"], esagraAtIssue: ["Eságara al emitir", "Eságara at issue"],
  bankBeneficiary: ["Beneficiario", "Beneficiary"], bankName: ["Banco", "Bank"], bankAccount: ["Cuenta", "Account"], bankSwift: ["SWIFT", "SWIFT"], bankVerifiedAt: ["Banco verificado", "Bank verified"],
  docBeneficiary: ["Beneficiario (documento)", "Beneficiary (document)"], docBankName: ["Banco (documento)", "Bank (document)"], docAccount: ["Cuenta (documento)", "Account (document)"], docSwift: ["SWIFT (documento)", "SWIFT (document)"],
  verifiedAt: ["Verificado", "Verified"], approvedAt: ["Aprobado", "Approved"], executedAt: ["Enviado al banco", "Sent to bank"], reconciledAt: ["Conciliado", "Reconciled"], releasedAt: ["Liberada", "Released"], presentedAt: ["Presentada", "Presented"], decidedAt: ["Decidida", "Decided"],
  creditLimit: ["Cupo de crédito", "Credit limit"], paymentTermsDays: ["Plazo de pago (días)", "Payment terms (days)"], role: ["Rol", "Role"], active: ["Activo", "Active"], version: ["Versión", "Version"], rev: ["Revisión", "Revision"],
  syncState: ["Contabilidad", "Accounting"], externalId: ["ID contable", "Accounting ID"], shortPayNote: ["Nota de pago corto", "Short-pay note"], dueAt: ["Vence", "Due"], dueBy: ["Fecha límite", "Due by"], promisedDate: ["Fecha prometida", "Promised date"],
};

const showVal = (v: unknown, i: ReturnType<typeof makeI18n>) => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? i.t("sí", "yes") : i.t("no", "no");
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return i.day(new Date(s));
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ g?: string; id?: string }> }) {
  const user = await requireUser();
  if (!canManageAll(user)) redirect("/mi-dia");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const group = GROUPS.find((g) => g.key === sp.g);
  const id = (sp.id ?? "").trim().slice(0, 60);
  const rows = await db.auditEvent.findMany({
    where: { ...(group ? { model: { in: group.models } } : {}), ...(id ? { entityId: id } : {}) },
    orderBy: { at: "desc" }, take: 200,
  });
  // Name each record (customer, supplier, document number) so the line reads on its own.
  const ids = (m: string) => [...new Set(rows.filter((r) => r.model === m).map((r) => r.entityId))];
  const [accs, sups, invs, spos, deals, users, quotes, pays] = await Promise.all([
    db.account.findMany({ where: { id: { in: ids("Account") } }, select: { id: true, name: true } }),
    db.supplier.findMany({ where: { id: { in: ids("Supplier") } }, select: { id: true, name: true } }),
    db.invoice.findMany({ where: { id: { in: ids("Invoice") } }, select: { id: true, number: true } }),
    db.supplierPO.findMany({ where: { id: { in: ids("SupplierPO") } }, select: { id: true, code: true } }),
    db.deal.findMany({ where: { id: { in: ids("Deal") } }, select: { id: true, code: true, title: true } }),
    db.user.findMany({ where: { id: { in: ids("User") } }, select: { id: true, name: true } }),
    db.quote.findMany({ where: { id: { in: ids("Quote") } }, select: { id: true, number: true, rev: true } }),
    db.supplierPayment.findMany({ where: { id: { in: ids("SupplierPayment") } }, select: { id: true, supplierPo: { select: { code: true, supplier: { select: { name: true } } } } } }),
  ]);
  const names = new Map<string, string>([
    ...accs.map((x) => [x.id, x.name] as [string, string]), ...sups.map((x) => [x.id, x.name] as [string, string]),
    ...invs.map((x) => [x.id, String(x.number)] as [string, string]), ...spos.map((x) => [x.id, x.code] as [string, string]),
    ...deals.map((x) => [x.id, `${x.code ?? ""} ${x.title}`.trim().slice(0, 60)] as [string, string]), ...users.map((x) => [x.id, x.name] as [string, string]),
    ...quotes.map((x) => [x.id, `${x.number}${x.rev ? ` Rev. ${x.rev}` : ""}`] as [string, string]), ...pays.map((x) => [x.id, `${x.supplierPo.supplier.name} · ${x.supplierPo.code}`] as [string, string]),
  ]);
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) { const k = r.at.toISOString().slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), r]); }
  const act = (a: string) => a === "CREATE" ? t("creó", "created") : a === "DELETE" ? t("eliminó", "deleted") : t("cambió", "changed");

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Administración", "Administration")}</div>
          <h1>{t("Historial de cambios", "Change history")}</h1>
          <p>{t("Cada cambio en dinero, datos bancarios, roles, compromisos y documentos: quién, cuándo, antes y después. SOLU lo registra solo; nadie puede editarlo.", "Every change to money, bank data, roles, commitments and documents: who, when, before and after. SOLU records it by itself; nobody can edit it.")}</p>
        </div>
      </div>
      <form className="card inline" style={{ alignItems: "flex-end" }}>
        <label>{t("Qué", "What")}
          <select name="g" defaultValue={group?.key ?? ""}><option value="">{t("Todo", "Everything")}</option>{GROUPS.map((g) => <option key={g.key} value={g.key}>{t(g.es, g.en)}</option>)}</select>
        </label>
        {id && <input type="hidden" name="id" value={id} />}
        <button type="submit" className="secondary">{t("Ver", "Show")}</button>
        {(group || id) && <Link href="/administracion/historial" className="small">{t("Ver todo", "Show all")}</Link>}
      </form>
      {id && <p className="note">{t("Mostrando solo el historial de un registro.", "Showing the history of one record only.")}</p>}
      {rows.length === 0 ? (
        <div className="card"><p>{t("Aún no hay cambios registrados con este filtro. Desde hoy, SOLU guarda aquí cada cambio material.", "No changes recorded with this filter yet. From today, SOLU keeps every material change here.")}</p></div>
      ) : [...byDay.entries()].map(([day, list]) => (
        <section key={day} className="jblock loc-sec">
          <div className="jbh"><b>{i.day(new Date(`${day}T12:00:00Z`)).toUpperCase()}</b><span className="grow" /><span className="src">{list.length} {list.length === 1 ? t("cambio", "change") : t("cambios", "changes")}</span></div>
          <ul className="audit-list">
            {list.map((r) => {
              const m = MODELS[r.model] ?? { es: r.model, en: r.model };
              const ch = Object.entries((r.changes ?? {}) as Ch);
              return (
                <li key={r.id}>
                  <div className="audit-head">
                    <span className="mono small">{new Intl.DateTimeFormat(user.lang === "EN" ? "en-US" : "es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }).format(r.at)}</span>
                    <span><b>{r.actorName}</b> {act(r.action)} · {m.href ? <Link href={m.href(r.entityId)}>{t(m.es, m.en)}</Link> : t(m.es, m.en)}{names.get(r.entityId) ? <b> · {names.get(r.entityId)}</b> : null}</span>
                    <Link href={`/administracion/historial?id=${encodeURIComponent(r.entityId)}`} className="src small">{t("historial de este registro", "this record's history")}</Link>
                  </div>
                  {ch.length > 0 && (
                    <table className="audit-ch"><tbody>{ch.slice(0, 12).map(([k, [b, a]]) => (
                      <tr key={k}><td className="src">{FIELDS[k] ? t(FIELDS[k][0], FIELDS[k][1]) : k}</td><td>{r.action === "CREATE" ? "" : showVal(b, i)}</td><td>{r.action === "DELETE" ? "" : <>→ {showVal(a, i)}</>}</td></tr>
                    ))}</tbody></table>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {rows.length === 200 && <p className="src small">{t("Se muestran los 200 cambios más recientes.", "Showing the 200 most recent changes.")}</p>}
    </>
  );
}
