import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { canFinance } from "@/lib/permissions";
import { dayInput, today } from "@/lib/domain";
import { IP_STATUS } from "@/lib/admin-rules";
import { ipAuthority } from "@/lib/internal-purchase";
import { CATEGORIES, KINDS, isMonthKey, monthKey, monthReport, monthSeries, monthStart } from "@/lib/internal-expenses";
import { InternalExpenseForm } from "@/components/InternalExpenseForm";
import { submitInternalExpense } from "./actions";

// Operaciones → Comprar → Compras internas: what the company buys for itself. Record it with its receipt, see where
// each one stands, approve what waits for you, and read the month's spending (chart, by category, by person, CSV).

export default async function InternalExpensesPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; id?: string; mes?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const finance = canFinance(user);
  const key = isMonthKey(sp.mes) ? sp.mes : monthKey(today());
  const [mineRows, waiting] = await Promise.all([
    db.internalPurchase.findMany({ where: { requesterId: user.id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, code: true, description: true, amount: true, currency: true, status: true, boughtAt: true, createdAt: true, decisionNote: true, _count: { select: { files: true } } } }),
    db.internalPurchase.findMany({ where: { status: "REQUESTED" }, orderBy: { createdAt: "asc" }, take: 60, include: { requester: { select: { name: true } }, _count: { select: { files: true } } } }),
  ]);
  const toDecide = (await Promise.all(waiting.map(async (p) => ((await ipAuthority(user, p)).ok ? p : null)))).filter((p): p is (typeof waiting)[number] => !!p);
  const [rep, series] = finance ? await Promise.all([monthReport(key), monthSeries(key, 6)]) : [null, []];
  const cat = (k: string | null) => { const c = CATEGORIES[k ?? "OTHER"] ?? CATEGORIES.OTHER; return t(c.es, c.en); };
  const kindLabel = (k: string) => t(KINDS[k]?.es ?? k, KINDS[k]?.en ?? k);
  const monthName = (k: string) => monthStart(k).toLocaleDateString(i.es ? "es-CO" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const shortMonth = (k: string) => monthStart(k).toLocaleDateString(i.es ? "es-CO" : "en-US", { month: "short", timeZone: "UTC" });
  const usd = (v: number) => `USD ${i.n2(v)}`;
  const max = Math.max(1, ...series.map((m) => m.products + m.services));
  const prev = (() => { const d = monthStart(key); return monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))); })();
  const next = (() => { const d = monthStart(key); return monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))); })();
  const okMsg: Record<string, string> = {
    pedida: t("Compra interna enviada. Queda esperando aprobación; cuando se apruebe entra al reporte del mes.", "Internal purchase sent. It waits for approval; once approved it enters the month's report."),
    "pedida-archivos": t("Compra interna enviada, pero algún archivo no se guardó (más de 5 MB, o no es foto ni PDF). Ábrela y súbelo de nuevo.", "Internal purchase sent, but a file was not saved (over 5 MB, or not a photo or PDF). Open it and upload it again."),
  };
  const errMsg: Record<string, string> = {
    datos: t("Faltan datos: qué se compró, si es producto o servicio, y cuánto costó. No se guardó nada.", "Missing data: what was bought, product or service, and how much it cost. Nothing was saved."),
    tasa: t("No se pudo consultar la tasa de cambio de esa moneda. Intenta de nuevo o escribe el valor en dólares.", "The exchange rate for that currency could not be fetched. Try again or type the amount in dollars."),
    fecha: t("La fecha de compra no puede ser futura.", "The purchase date cannot be in the future."),
  };
  const state = (p: { status: string; boughtAt: Date | null }) => p.status === "APPROVED" ? (p.boughtAt ? { tone: "ok", text: t("Aprobada · en el reporte", "Approved · in the report") } : { tone: "attn", text: t("Aprobada · falta comprarla", "Approved · not bought yet") }) : { tone: IP_STATUS[p.status]?.tone ?? "wait", text: t(IP_STATUS[p.status]?.es ?? p.status, IP_STATUS[p.status]?.en ?? p.status) };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Compras internas", "Internal purchases")}</h1>
        <p>{t("Lo que la empresa compra para sí misma: productos (un mouse, un portátil, grapas) o servicios (capacitaciones, mantenimiento, cursos). No es para vender ni para un cliente. Cualquier persona registra su compra con el recibo; una vez aprobada, entra al reporte de gastos del mes.", "What the company buys for itself: products (a mouse, a laptop, staples) or services (training, maintenance, courses). Not for sale and not for a customer. Anyone records a purchase with its receipt; once approved, it enters the month's spending report.")}</p>
      </div></div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]} {sp.id && <Link href={`/administracion/compras-internas/${sp.id}`}>{t("Abrir la compra", "Open the purchase")} →</Link>}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      {toDecide.length > 0 && (
        <section className="card" id="aprobar">
          <h2>{t("Esperan tu aprobación", "Waiting for your approval")} <span className="sig attn">{toDecide.length}</span></h2>
          <ol className="pd-list">
            {toDecide.map((p, n) => (
              <li key={p.id} className="pd-row">
                <span className="pd-n" aria-hidden>{n + 1}</span>
                <span className="pd-t"><b>{p.description}</b><span className="pd-d">{p.requester.name}{p.requesterId === user.id ? t(" (tú)", " (you)") : ""} · {kindLabel(p.kind)} · {cat(p.category)}</span><span className="src">{p.currency} {i.n2(p.amount)} · {p._count.files ? t(`${p._count.files} recibo(s)`, `${p._count.files} receipt(s)`) : <b className="risk-t">{t("sin recibo", "no receipt")}</b>} · {p.code}</span></span>
                <a className="btn" href={`/administracion/compras-internas/${p.id}#autoridad`}>{t("Revisar y aprobar", "Review and approve")} →</a>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card" id="nueva">
        <h2>{t("Registrar una compra interna", "Record an internal purchase")}</h2>
        <InternalExpenseForm lang={user.lang} action={submitInternalExpense} todayStr={dayInput(today())}
          kinds={[{ key: "PRODUCT", label: t("Producto", "Product"), hint: t("mouse, portátil, grapas", "mouse, laptop, staples") }, { key: "SERVICE", label: t("Servicio", "Service"), hint: t("capacitación, mantenimiento, cursos", "training, maintenance, courses") }]}
          categories={Object.entries(CATEGORIES).map(([k, c]) => ({ key: k, label: t(c.es, c.en), hint: t(c.hint.es, c.hint.en) }))} />
      </section>

      <section className="card" id="mias">
        <h2>{t("Mis compras internas", "My internal purchases")}</h2>
        {mineRows.length === 0 ? <p className="small muted">{t("Aún no has registrado ninguna. Usa el formulario de arriba.", "You have not recorded any yet. Use the form above.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Compra", "Purchase")}</th><th className="n">{t("Valor", "Amount")}</th><th>{t("Recibo", "Receipt")}</th><th>{t("En qué va", "Where it stands")}</th><th /></tr></thead>
            <tbody>{mineRows.map((p) => { const s = state(p); return (
              <tr key={p.id} id={`c-${p.id}`}>
                <td><b>{p.description}</b><span className="src block">{p.code} · {i.day(p.boughtAt ?? p.createdAt)}</span></td>
                <td className="n mono">{p.currency} {i.n2(p.amount)}</td>
                <td>{p._count.files ? `${p._count.files}` : <a className="chk-a risk-t" href={`/administracion/compras-internas/${p.id}#recibos`}>{t("Falta: subir el recibo", "Missing: upload the receipt")} <span aria-hidden>→</span></a>}</td>
                <td><span className={`sig ${s.tone}`}>{s.text}</span>{p.status === "RETURNED" && p.decisionNote && <span className="src block">{t("Pregunta", "Question")}: {p.decisionNote}</span>}</td>
                <td><a className="btn secondary sm" href={`/administracion/compras-internas/${p.id}`}>{p.status === "RETURNED" ? t("Responder", "Answer") : t("Abrir", "Open")} →</a></td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}
      </section>

      {rep && (
        <section className="card" id="reporte">
          <div className="jbh"><b>{t("REPORTE DE GASTOS INTERNOS", "INTERNAL SPENDING REPORT")}</b><span className="grow" />
            <a className="btn secondary sm" href={`/compras/internas?mes=${prev}#reporte`}>← {shortMonth(prev)}</a>
            <b style={{ textTransform: "capitalize" }}>{monthName(key)}</b>
            <a className="btn secondary sm" href={`/compras/internas?mes=${next}#reporte`}>{shortMonth(next)} →</a>
            <a className="btn sm" href={`/compras/internas/reporte?mes=${key}`}>{t("Descargar para Excel", "Download for Excel")}</a>
          </div>
          <p className="src">{t("Cuenta las compras aprobadas, en el mes en que se compraron, en dólares. Lo que está esperando aprobación no aparece.", "It counts approved purchases, in the month they were bought, in dollars. What is waiting for approval is not shown.")}</p>
          <div className="goal-grid">
            <div className="goal-card"><span className="small muted">{t("Total del mes", "Month total")}</span><b className="tv">{usd(rep.total)}</b><span className="src">{t(`${rep.rows.length} compra(s)`, `${rep.rows.length} purchase(s)`)}</span></div>
            <div className="goal-card"><span className="small muted">{t("Productos", "Products")}</span><b className="tv">{usd(rep.products)}</b></div>
            <div className="goal-card"><span className="small muted">{t("Servicios", "Services")}</span><b className="tv">{usd(rep.services)}</b></div>
            <div className="goal-card"><span className="small muted">{t("Sin recibo", "Without receipt")}</span><b className={`tv${rep.noReceipt ? " risk-t" : ""}`}>{rep.noReceipt}</b></div>
          </div>

          <h3 className="ie-h">{t("¿Cómo va el gasto en los últimos 6 meses?", "How has spending moved over the last 6 months?")}</h3>
          <div className="ie-chart" role="img" aria-label={t("Gasto interno por mes, productos y servicios", "Internal spending by month, products and services")}>
            {series.map((m) => (
              <a key={m.key} className={`ie-bar${m.key === key ? " on" : ""}`} href={`/compras/internas?mes=${m.key}#reporte`} title={`${monthName(m.key)} · ${usd(m.products + m.services)}`}>
                <span className="ie-val">{m.products + m.services > 0 ? i.n(m.products + m.services) : "—"}</span>
                <span className="ie-col"><span className="s" style={{ height: `${(m.services / max) * 100}%` }} /><span className="p" style={{ height: `${(m.products / max) * 100}%` }} /></span>
                <span className="ie-m">{shortMonth(m.key)}</span>
              </a>
            ))}
          </div>
          <p className="src"><span className="ie-key p" /> {t("Productos", "Products")} · <span className="ie-key s" /> {t("Servicios", "Services")} · USD</p>

          {rep.rows.length === 0 ? <p className="small muted">{t("No hay compras internas aprobadas en este mes.", "No approved internal purchases in this month.")}</p> : (
            <>
              <div className="exc-grid">
                <div><h3 className="ie-h">{t("¿En qué se fue?", "Where did it go?")}</h3>
                  <table><tbody>{rep.byCategory.map((c) => <tr key={c.key}><td>{cat(c.key)}</td><td className="n mono">{usd(c.usd)}</td><td className="n src">{rep.total > 0 ? `${Math.round((c.usd / rep.total) * 100)} %` : ""}</td></tr>)}</tbody></table>
                </div>
                <div><h3 className="ie-h">{t("¿Quién compró?", "Who bought?")}</h3>
                  <table><tbody>{rep.byPerson.map((c) => <tr key={c.key}><td>{c.key}</td><td className="n mono">{usd(c.usd)}</td><td className="n src">{c.n}</td></tr>)}</tbody></table>
                </div>
              </div>
              <h3 className="ie-h">{t("Cada compra del mes", "Each purchase of the month")}</h3>
              <div className="tscroll"><table>
                <thead><tr><th>{t("Fecha", "Date")}</th><th>{t("Compra", "Purchase")}</th><th>{t("Categoría", "Category")}</th><th>{t("Quién", "Who")}</th><th className="n">USD</th><th>{t("Recibo", "Receipt")}</th></tr></thead>
                <tbody>{rep.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{i.day(r.boughtAt!)}</td>
                    <td><Link href={`/administracion/compras-internas/${r.id}`}>{r.description}</Link><span className="src block">{r.code} · {kindLabel(r.kind)}{r.supplier?.name ?? r.supplierName ? ` · ${r.supplier?.name ?? r.supplierName}` : ""}</span></td>
                    <td className="small">{cat(r.category)}</td>
                    <td className="small">{r.requester.name}</td>
                    <td className="n mono">{i.n2(r.amountUsd)}</td>
                    <td className="small">{r.files.length === 0 ? <span className="risk-t">{t("Sin recibo", "No receipt")}</span> : r.files.map((f, n) => <a key={f.id} href={`/compras/internas/recibo/${f.id}`} target="_blank" rel="noopener" style={{ marginRight: 8 }}>{t("Ver", "View")} {n + 1}</a>)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>
          )}
        </section>
      )}
      {!finance && <p className="src">{t("El reporte de gastos del mes lo ven Finanzas, Administración, Dirección y Gerencia.", "The month's spending report is seen by Finance, Administration, Direction and Management.")}</p>}
    </>
  );
}
