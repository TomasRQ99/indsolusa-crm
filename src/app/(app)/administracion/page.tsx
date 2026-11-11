import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { adminHome } from "@/lib/admin-home";

// Módulo 14 §4 · Administration Home. Not a dashboard: only what needs a person today, each line with its impact,
// the reason and where to act (AC17). What is fine stays quiet in one line. People outside Administración see
// what is theirs: their record, their assets, their requests.

export default async function AdminHomePage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;

  if (!canFinance(user)) {
    const [assets, purchases, gaps, budgets, absences] = await Promise.all([
      db.asset.count({ where: { custodianId: user.id, status: { not: "DISPOSED" } } }),
      db.internalPurchase.count({ where: { requesterId: user.id, status: { in: ["REQUESTED", "RETURNED"] } } }),
      db.supportGap.count({ where: { userId: user.id, status: { not: "RESOLVED" } } }),
      db.budget.count({ where: { ownerId: user.id, closedAt: null } }),
      db.absenceRecord.count({ where: { userId: user.id, status: "REQUESTED" } }),
    ]);
    return (
      <>
        <div className="ph"><div><h1>{t("Administración", "Administration")}</h1><p>{t("Lo tuyo con la empresa: tu ficha, lo que tienes a cargo y lo que has pedido.", "What is yours with the company: your record, what is in your care and what you have requested.")}</p></div></div>
        <section className="card"><ul className="plain">
          <li><Link href={`/administracion/personas/${user.id}`}><b>{t("Mi ficha administrativa", "My administrative record")}</b></Link> <span className="small muted">· {t("cargo, ausencias, soporte que la empresa te debe", "position, absences, support the company owes you")}{absences ? ` · ${t(`${absences} ausencia(s) pedida(s)`, `${absences} absence(s) requested`)}` : ""}{gaps ? ` · ${t(`${gaps} pendiente(s) de soporte`, `${gaps} support item(s) open`)}` : ""}</span></li>
          <li><Link href="/administracion/activos"><b>{t("Activos a mi cargo", "Assets in my care")}</b></Link> <span className="small muted">· {assets}</span></li>
          <li><Link href="/administracion/compras-internas"><b>{t("Pedir una compra interna", "Request an internal purchase")}</b></Link> <span className="small muted">· {t(`${purchases} en curso`, `${purchases} in progress`)}</span></li>
          {budgets > 0 && <li><Link href="/administracion/presupuesto"><b>{t("Mis presupuestos", "My budgets")}</b></Link> <span className="small muted">· {budgets}</span></li>}
          <li><Link href="/administracion/cobrar"><b>{t("Cuentas por cobrar de mis clientes", "Receivables of my customers")}</b></Link> · <Link href="/administracion/cupos">{t("Cupos de crédito", "Credit limits")}</Link></li>
        </ul></section>
      </>
    );
  }

  const h = await adminHome(user.id);
  return (
    <>
      <div className="ph"><div><h1>{t("Administración: lo que necesita a alguien hoy", "Administration: what needs someone today")}</h1>
        <p>{h.total === 0 ? t("Nada pide atención ahora. Lo normal se mueve en silencio.", "Nothing asks for attention now. What is normal moves silently.") : t(`${h.total} asunto(s). Cada uno dice cuánto pesa, por qué y dónde se resuelve.`, `${h.total} matter(s). Each says how much it weighs, why and where it is resolved.`)}</p>
        <p className="small">{t("calculado", "as of")} {i.date(h.asOf)} · <Link href="/administracion/exposicion">{t("Exposición de recursos", "Resource exposure")}</Link></p></div></div>
      {h.sections.map((s) => (
        <section key={s.key} className="card" id={s.key}>
          <b>{t(s.title.es, s.title.en)}</b>{s.items.length ? <span className="small muted"> · {s.items.length}</span> : null} <span className="small">· <Link href={s.href}>{t("abrir", "open")}</Link></span>
          {s.items.length === 0 ? <p className="small"><span className="sig ok">{t(s.quiet.es, s.quiet.en)}</span></p> : (
            <div className="tscroll"><table>
              <thead><tr><th>{t("Qué pasa", "What is happening")}</th><th className="n">{t("Cuánto pesa", "Impact")}</th><th>{t("Por qué", "Why")}</th><th>{t("Qué hacer", "What to do")}</th></tr></thead>
              <tbody>{s.items.map((x, k) => (
                <tr key={k}><td><span className={`sig ${x.tone}`}>{x.tone === "risk" ? t("riesgo", "risk") : t("atención", "attention")}</span> {t(x.what.es, x.what.en)}</td><td className="n mono">{x.impact ?? "—"}</td><td className="small">{t(x.why.es, x.why.en)}</td><td><Link href={x.href}>{t(x.action.es, x.action.en)}</Link></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      ))}
    </>
  );
}
