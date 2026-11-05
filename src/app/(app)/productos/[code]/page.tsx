import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { daysBetween, today } from "@/lib/domain";
import { freshness, normCode, type Fresh } from "@/lib/x360";
import { stateLabel } from "@/lib/result";
import { PriceLine } from "@/components/Trend";
import { Popovers } from "@/components/Popovers";
import { addProductFact, createNeedFromContext } from "../actions";

export default async function Product360({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const code = normCode(decodeURIComponent((await params).code));
  const sp = await searchParams;
  const now = today();
  const byCode = { code: { equals: code, mode: "insensitive" as const } };

  const [items, buys, qlines, facts, accounts] = await Promise.all([
    db.dealItem.findMany({ where: byCode, include: { deal: { include: { account: { select: { id: true, name: true } }, resultEvidence: { orderBy: { at: "desc" } }, recoveries: true } }, deliveryLines: { include: { delivery: { select: { deliveredAt: true } } } } } }),
    db.supplierPOLine.findMany({ where: byCode, include: { supplierPo: { include: { supplier: { select: { id: true, name: true } }, deal: { select: { id: true, code: true, account: { select: { name: true } } } } } } } }),
    db.quoteLine.findMany({ where: byCode, include: { quote: { select: { id: true, number: true, rev: true, status: true, createdAt: true, deal: { select: { id: true, code: true, stage: true, account: { select: { name: true } } } } } } } }),
    db.productFact.findMany({ where: { code }, orderBy: { observedAt: "desc" } }),
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true }, take: 300 }),
  ]);
  if (!items.length && !buys.length && !qlines.length && !facts.length) notFound();
  const F = ({ f, src }: { f: Fresh; src?: string | null }) => <span className={`fresh${f.stale ? " stale" : ""}`}>{src ? `${src} · ` : ""}{f.label}{f.stale && f.at ? ` · ${t("confirmar", "re-confirm")}` : ""}</span>;

  // Identity: the most used description, and every other name it appears under (with where).
  const names = new Map<string, { n: number; where: Set<string> }>();
  const seen = (d: string, w: string) => { const k = d.trim(); const x = names.get(k) ?? { n: 0, where: new Set<string>() }; x.n++; x.where.add(w); names.set(k, x); };
  items.forEach((x) => seen(x.description, t("Journey", "Journey")));
  buys.forEach((x) => seen(x.description, t("PO a proveedor", "Supplier PO")));
  qlines.forEach((x) => seen(x.description, t("cotización", "quote")));
  const ranked = [...names.entries()].sort((a, b) => b[1].n - a[1].n);
  const name = ranked[0]?.[0] ?? facts.find((f) => f.kind === "SPEC")?.text ?? code;
  const autoAliases = ranked.slice(1);
  const aliasFacts = facts.filter((f) => f.kind === "ALIAS");

  // Purchases and sources
  const purchases = buys.map((b) => ({ b, at: b.supplierPo.releasedAt ?? b.supplierPo.createdAt, cost: Number(b.unitCost), cur: b.supplierPo.currency })).sort((x, y) => +x.at - +y.at);
  const lastBuy = purchases[purchases.length - 1] ?? null;
  const sources = new Map<string, { id: string; name: string; n: number; qty: number; last: Date; lastCost: number; cur: string; rts: number[] }>();
  for (const x of purchases) {
    const s = x.b.supplierPo.supplier;
    const cur = sources.get(s.id) ?? { id: s.id, name: s.name, n: 0, qty: 0, last: x.at, lastCost: x.cost, cur: x.cur, rts: [] };
    cur.n++; cur.qty += x.b.qty; if (x.at >= cur.last) { cur.last = x.at; cur.lastCost = x.cost; cur.cur = x.cur; }
    const po = x.b.supplierPo;
    if (po.shipBy && po.shippedAt) cur.rts.push(daysBetween(po.shipBy, po.shippedAt));
    sources.set(s.id, cur);
  }
  const trendCur = lastBuy?.cur;
  const trendPts = purchases.filter((x) => x.cur === trendCur);

  // Customers and installed base
  const custMap = new Map<string, { id: string; name: string; qty: number; last: Date | null; deals: { id: string; code: string | null; state: Parameters<typeof stateLabel>[1] }[] }>();
  for (const it of items) {
    const delivered = it.deliveryLines.reduce((s, l) => s + l.qty, 0);
    if (!delivered) continue;
    const a = it.deal.account;
    const c = custMap.get(a.id) ?? { id: a.id, name: a.name, qty: 0, last: null, deals: [] };
    c.qty += delivered;
    const last = it.deliveryLines.map((l) => l.delivery.deliveredAt).sort((x, y) => +y - +x)[0] ?? null;
    if (last && (!c.last || last > c.last)) c.last = last;
    c.deals.push({ id: it.deal.id, code: it.deal.code, state: it.deal.resultState });
    custMap.set(a.id, c);
  }
  const customers = [...custMap.values()].sort((a, b) => +(b.last ?? 0) - +(a.last ?? 0));

  // Compatibility evidence: explicit facts + what happened in Journeys that used it.
  type Ev = { at: Date; ok: boolean | null; text: string; src: string; href?: string };
  const compat: Ev[] = facts.filter((f) => f.kind === "COMPAT_OK" || f.kind === "COMPAT_NO").map((f) => ({ at: f.observedAt, ok: f.kind === "COMPAT_OK", text: f.text, src: `${f.source ?? f.recordedByName}` }));
  for (const it of items) {
    for (const e of it.deal.resultEvidence.filter((e) => e.stance === "CONTRADICTS" || e.stance === "SUPPORTS").slice(0, 2)) compat.push({ at: e.at, ok: e.stance === "SUPPORTS", text: e.text, src: `${it.deal.account.name} · ${e.who ?? ""}`, href: `/deals/${it.deal.id}/resultado` });
    for (const r of it.deal.recoveries) compat.push({ at: r.openedAt, ok: false, text: `Recovery: ${r.whatChanged}`, src: `${it.deal.account.name} · ${it.deal.code}`, href: `/deals/${it.deal.id}/resultado` });
  }
  compat.sort((a, b) => +b.at - +a.at);
  // One incompatibility per explicit fact or per Journey where it failed (evidence + recovery count once).
  const incompat = facts.filter((f) => f.kind === "COMPAT_NO").length + items.filter((it) => it.deal.recoveries.length || it.deal.resultEvidence.some((e) => e.stance === "CONTRADICTS")).length;
  const packing = facts.filter((f) => f.kind === "PACKING");
  const specs = facts.filter((f) => f.kind === "SPEC");

  // Open needs: open Journeys and undecided quotes that include it.
  const openNeeds = [
    ...items.filter((x) => x.deal.stage !== "WON" && x.deal.stage !== "LOST").map((x) => ({ key: x.id, href: `/deals/${x.deal.id}`, label: `${x.deal.code ?? ""} · ${x.deal.account.name}`, detail: `${x.qty} u · ${t("Journey abierto", "open Journey")}` })),
    ...qlines.filter((q) => q.quote.status === "DRAFT" || q.quote.status === "PRESENTED").map((q) => ({ key: q.id, href: `/cotizaciones/${q.quote.id}`, label: `${q.quote.number}${q.quote.rev ? ` R${q.quote.rev}` : ""} · ${q.quote.deal.account.name}`, detail: `${q.qty} u · ${q.quote.status === "DRAFT" ? t("cotización en borrador", "draft quote") : t("cotización presentada", "presented quote")}` })),
  ];
  const priceF = freshness(i, lastBuy?.at ?? null, 180, now);
  const kindName: Record<string, string> = { ALIAS: t("Alias", "Alias"), PACKING: t("Empaque observado", "Observed packing"), COMPAT_OK: t("Compatible con", "Compatible with"), COMPAT_NO: t("No compatible con", "Not compatible with"), SPEC: t("Especificación", "Spec") };

  return (
    <div className="jw x3">
      {sp.ok && <div className="note okn">{t("Hecho registrado con su fuente.", "Fact recorded with its source.")}</div>}
      {sp.err && <div className="note risk">{t("Falta el dato.", "The value is missing.")}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/productos">{t("Productos", "Products")}</Link></p>
          <span className="jid">Product 360 · {code}</span>
          <span className="grow" />
        </div>
        <div className="jh-title"><h1>{name}</h1></div>
        <p className="jh-sub">{code}{specs[0] ? ` · ${specs[0].text}` : ""}{autoAliases.length + aliasFacts.length ? ` · ${t(`${autoAliases.length + aliasFacts.length} alias`, `${autoAliases.length + aliasFacts.length} aliases`)}` : ""}</p>
      </header>

      {purchases.length + customers.length <= 1 && <div className="note">{t("Producto con poco conocimiento: aún no hay compras o clientes suficientes para comparar. Registra lo que observes (empaque, compatibilidad) con su fuente.", "Product with little knowledge: not enough purchases or customers to compare yet. Record what you observe (packing, compatibility) with its source.")}</div>}

      <section className="x3-facts">
        <div className={`x3-f${priceF.stale && lastBuy ? " stale" : ""}`}>
          <span className="k">{t("ÚLTIMA COMPRA REAL", "LAST ACTUAL PURCHASE")}</span>
          <b>{lastBuy ? `${lastBuy.cur} ${i.n2(lastBuy.cost)} / u` : t("Nunca comprado", "Never purchased")}</b>
          <span className="src">{lastBuy ? `${lastBuy.b.supplierPo.supplier.name} · ${lastBuy.b.supplierPo.code}` : t("sin precio real; solo cotizaciones", "no actual price; quotes only")}</span>
          {lastBuy && <F f={priceF} src={t("precio", "price")} />}
          {lastBuy && priceF.stale && <span className="small attn-t">{t("Precio viejo: re-cotiza antes de prometer.", "Old price: re-quote before promising.")}</span>}
        </div>
        <div className="x3-f">
          <span className="k">{t("FUENTES", "SOURCES")}</span>
          <b>{sources.size ? t(`${sources.size} proveedor(es)`, `${sources.size} supplier(s)`) : "—"}</b>
          <span className="src">{[...sources.values()].map((s) => s.name).join(" · ") || t("ninguna compra registrada", "no purchase recorded")}</span>
        </div>
        <div className={`x3-f${incompat ? " risk" : ""}`}>
          <span className="k">{t("COMPATIBILIDAD", "COMPATIBILITY")}</span>
          <b>{incompat ? t(`${incompat} incompatibilidad(es) registrada(s)`, `${incompat} incompatibility(ies) on record`) : compat.length ? t("Sin incompatibilidades registradas", "No incompatibility on record") : t("Sin evidencia", "No evidence")}</b>
          <span className="src">{compat.length ? t(`${compat.length} evidencia(s) de uso real`, `${compat.length} piece(s) of real-use evidence`) : t("nadie ha registrado dónde funciona", "nobody has recorded where it works")}</span>
        </div>
        <div className="x3-f">
          <span className="k">{t("NECESIDADES ABIERTAS", "OPEN NEEDS")}</span>
          <b>{openNeeds.length || t("Ninguna", "None")}</b>
          <span className="src">{customers.length ? t(`${customers.length} cliente(s) lo tienen instalado`, `${customers.length} customer(s) have it installed`) : t("sin clientes todavía", "no customers yet")}</span>
        </div>
      </section>

      <div className="jbody">
        <div className="jmain">
          <section className="jblock">
            <div className="jbh"><b>{t("COMPRAS REALES", "ACTUAL PURCHASES")}</b><span className="grow" /><span className="src">{t("costo unitario pagado al proveedor", "unit cost paid to the supplier")}</span></div>
            {trendPts.length >= 3 && <PriceLine title={t("Costo unitario por compra", "Unit cost per purchase")} pts={trendPts.map((x) => ({ label: i.dateShort(x.at).replace(/^\w+,\s*/, ""), value: x.cost, tip: `${x.b.supplierPo.code} · ${x.b.supplierPo.supplier.name} · ${x.cur} ${i.n2(x.cost)}` }))} />}
            {purchases.length === 0 ? <p className="quiet-p">{t("Nunca se ha comprado. Cualquier precio viene de una cotización.", "Never purchased. Any price comes from a quote.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>{t("Fecha", "Date")}</th><th>{t("Proveedor", "Supplier")}</th><th>PO · Journey</th><th className="n">{t("Cant.", "Qty")}</th><th className="n">{t("Costo u.", "Unit cost")}</th></tr></thead>
                <tbody>{purchases.slice().reverse().map((x) => (
                  <tr key={x.b.id}>
                    <td className="mono">{i.day(x.at)}</td>
                    <td><Link href={`/suppliers/${x.b.supplierPo.supplier.id}`}>{x.b.supplierPo.supplier.name}</Link></td>
                    <td className="small"><Link href={`/compras/${x.b.supplierPo.id}`}>{x.b.supplierPo.code}</Link> · <Link href={`/deals/${x.b.supplierPo.deal.id}`}>{x.b.supplierPo.deal.code}</Link></td>
                    <td className="n mono">{x.b.qty}</td>
                    <td className="n mono">{x.cur} {i.n2(x.cost)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("FUENTES", "SOURCES")}</b></div>
            {sources.size === 0 ? <p className="quiet-p">{t("Sin proveedor conocido.", "No known supplier.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>{t("Proveedor", "Supplier")}</th><th className="n">{t("Compras", "Purchases")}</th><th className="n">{t("Último costo", "Last cost")}</th><th>{t("RTS real", "Actual RTS")}</th><th>{t("Precio conocido", "Price known")}</th></tr></thead>
                <tbody>{[...sources.values()].map((s) => (
                  <tr key={s.id}>
                    <td><Link href={`/suppliers/${s.id}`}>{s.name}</Link></td>
                    <td className="n mono">{s.n} · {s.qty} u</td>
                    <td className="n mono">{s.cur} {i.n2(s.lastCost)}</td>
                    <td className="small">{s.rts.length ? s.rts.map((d) => (d > 0 ? `+${d}` : `${d}`)).join(", ") + " d" : <span className="src">{t("sin medir", "not measured")}</span>}</td>
                    <td><F f={freshness(i, s.last, 180, now)} /></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("CLIENTES QUE LO TIENEN", "CUSTOMERS WHO HAVE IT")}</b></div>
            {customers.length === 0 ? <p className="quiet-p">{t("Ningún cliente lo ha recibido todavía.", "No customer has received it yet.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>{t("Cliente", "Customer")}</th><th className="n">{t("Entregado", "Delivered")}</th><th>{t("Última entrega", "Last delivery")}</th><th>{t("Resultado", "Result")}</th></tr></thead>
                <tbody>{customers.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/accounts/${c.id}`}>{c.name}</Link></td>
                    <td className="n mono">{c.qty} u</td>
                    <td className="mono">{c.last ? i.day(c.last) : "—"}</td>
                    <td>{c.deals.map((d) => { const L = stateLabel(i, d.state); return <Link key={d.id} href={`/deals/${d.id}/resultado`} className={`sig ${L.cls}`} style={{ marginRight: 4 }}>{d.code} · {L.text}</Link>; })}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("EVIDENCIA DE COMPATIBILIDAD", "COMPATIBILITY EVIDENCE")}</b></div>
            {compat.length === 0 ? <p className="quiet-p">{t("Sin evidencia todavía.", "No evidence yet.")}</p> : (
              <ul className="x3-h">{compat.map((c, n) => (
                <li key={n} className={c.ok === false ? "risk" : c.ok ? "ok" : "dash"}><span className="mono">{i.day(c.at)}</span><span>{c.href ? <Link href={c.href}><b>{c.text}</b></Link> : <b>{c.text}</b>}<span className="src block">{c.ok === false ? t("no compatible · ", "not compatible · ") : c.ok ? t("funciona · ", "works · ") : ""}{c.src}</span></span></li>
              ))}</ul>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("EMPAQUE OBSERVADO", "OBSERVED PACKING")}</b></div>
            {packing.length === 0 ? <p className="quiet-p">{t("Nadie ha registrado cómo llega. Sirve para cotizar flete sin adivinar.", "Nobody has recorded how it arrives. It helps quote freight without guessing.")}</p> : (
              <ul className="plain small">{packing.map((f) => <li key={f.id}><b>{f.text}</b> <F f={freshness(i, f.observedAt, 365, now)} src={f.source ?? f.recordedByName} /></li>)}</ul>
            )}
          </section>
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("IDENTIDAD", "IDENTITY")}</b></div>
            <dl className="filedl">
              <dt>{t("Código", "Code")}</dt><dd className="mono">{code}</dd>
              <dt>{t("Nombre", "Name")}</dt><dd>{name}</dd>
              {specs.map((f) => <Fragment key={f.id}><dt>{t("Espec.", "Spec")}</dt><dd>{f.text} <F f={freshness(i, f.observedAt, 730, now)} src={f.source} /></dd></Fragment>)}
            </dl>
            {(autoAliases.length > 0 || aliasFacts.length > 0) && (
              <>
                <p className="small" style={{ margin: "10px 0 4px" }}><b>{t("También aparece como", "Also appears as")}</b></p>
                <ul className="plain small">
                  {autoAliases.map(([d, x]) => <li key={d}>{d}<span className="src block">{[...x.where].join(", ")}</span></li>)}
                  {aliasFacts.map((f) => <li key={f.id}>{f.text}<span className="src block">{f.source ?? f.recordedByName} · {i.day(f.observedAt)}</span></li>)}
                </ul>
              </>
            )}
          </div>
          {openNeeds.length > 0 && (
            <div>
              <div className="jbh"><b>{t("NECESIDADES ABIERTAS", "OPEN NEEDS")}</b></div>
              <ul className="plain small">{openNeeds.map((o) => <li key={o.key}><Link href={o.href}>{o.label}</Link><span className="src block">{o.detail}</span></li>)}</ul>
            </div>
          )}
          <div className="qa-bar col">
            <details className="qa"><summary className="qa-btn">{t("Registrar hecho observado", "Record observed fact")}</summary><div className="qa-pop wide">
              <form action={addProductFact.bind(null, code)} className="qa-form">
                <label>{t("Tipo", "Kind")}<select name="kind" defaultValue="PACKING">{Object.entries(kindName).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label>{t("Qué se observó", "What was observed")}<input name="text" required placeholder={t("Ej.: caja individual 32×20×15 cm, 1,8 kg", "E.g.: single box 32×20×15 cm, 1.8 kg")} /></label>
                <label>{t("Fuente", "Source")}<input name="source" required placeholder={t("Ej.: recibo en bodega, REM-2611-0002", "E.g.: warehouse receipt, REM-2611-0002")} /></label>
                <label>{t("Observado el", "Observed on")}<input name="observedAt" type="date" /></label>
                <button type="submit">{t("Guardar", "Save")}</button>
              </form>
            </div></details>
            <details className="qa"><summary className="qa-btn">{t("Crear necesidad con este producto", "Create need with this product")}</summary><div className="qa-pop wide">
              <form action={createNeedFromContext} className="qa-form">
                <input type="hidden" name="context" value={`Product 360 · ${code}`} />
                <input type="hidden" name="back" value={`/productos/${encodeURIComponent(code)}`} />
                <label>{t("Cliente", "Customer")}<select name="accountId" required defaultValue={customers[0]?.id}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
                <label>{t("Qué necesita", "What they need")}<input name="title" required defaultValue={name} /></label>
                <input type="hidden" name="needSpecs" value={`${code} · ${name}`} />
                <input type="hidden" name="sourcingNote" value={lastBuy ? `${t("Última compra", "Last purchase")}: ${lastBuy.b.supplierPo.supplier.name} ${lastBuy.cur} ${i.n2(lastBuy.cost)} (${i.day(lastBuy.at)})` : ""} />
                <button type="submit">{t("Crear y abrir", "Create and open")}</button>
              </form>
            </div></details>
          </div>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}
