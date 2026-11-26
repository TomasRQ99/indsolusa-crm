import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import { STATE_TXT, type ShownState } from "@/lib/sales-budget-rules";

// Presupuesto comercial · pieces shared by its screens. Money is shown in millions of pesos ("$ 40 M").

export function budgetFmt(i: I18n) {
  const locale = i.es ? "es-CO" : "en-US";
  const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const m = (v: number | null | undefined) => (v == null ? "—" : `$ ${one.format(v / 1e6)} M`);
  return {
    /** "$ 40 M" */
    m,
    /** "40" (for a table whose caption already says millions of pesos) */
    bare: (v: number | null | undefined) => (v == null ? "—" : one.format(v / 1e6)),
    pct: (v: number | null | undefined) => (v == null ? "—" : `${one.format(v)} %`),
    signed: (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${one.format(v)} %`),
  };
}

export const SECTIONS = [
  { key: "empresas", href: "/comercial/presupuesto", es: "Mis empresas", en: "My companies" },
  { key: "consolidacion", href: "/comercial/presupuesto/consolidacion", es: "Consolidación", en: "Consolidation" },
  { key: "aprobaciones", href: "/comercial/presupuesto/aprobaciones", es: "Aprobaciones", en: "Approvals" },
  { key: "cumplimiento", href: "/comercial/presupuesto/cumplimiento", es: "Cumplimiento y radar", en: "Achievement and radar" },
  { key: "historial", href: "/comercial/presupuesto/historial", es: "Historial", en: "History" },
] as const;

/** The row that moves between the screens and between the years, keeping the person chosen. */
export function BudgetNav({ i, active, year, years, personId, extra = "" }: { i: I18n; active: (typeof SECTIONS)[number]["key"]; year: number; years: number[]; personId?: string | null; extra?: string }) {
  const { t } = i;
  const qs = (y: number) => `?y=${y}${personId ? `&u=${personId}` : ""}${extra}`;
  const here = SECTIONS.find((s) => s.key === active)!;
  return (
    <nav className="pc-nav" aria-label={t("Presupuesto comercial", "Commercial budget")}>
      <span className="pc-tabs">
        {SECTIONS.map((s) => <Link key={s.key} href={`${s.href}${qs(year)}`} className={s.key === active ? "on" : ""} aria-current={s.key === active ? "page" : undefined}>{t(s.es, s.en)}</Link>)}
      </span>
      <span className="grow" />
      {years.length > 0 && (
        <span className="pc-years">
          <span className="src">{t("Año", "Year")}</span>
          {years.map((y) => <Link key={y} href={`${here.href}${qs(y)}`} className={y === year ? "on" : ""} aria-current={y === year ? "true" : undefined}>{y}</Link>)}
        </span>
      )}
    </nav>
  );
}

export function StateChip({ i, state }: { i: I18n; state: ShownState }) {
  const s = STATE_TXT[state];
  return <span className={`sig ${s.tone}`}>{i.t(s.es, s.en)}</span>;
}
