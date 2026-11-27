import { MarkNeed } from "@/components/WorkingNeed";
import Link from "next/link";
import { GuideWhy } from "@/components/GuideWhy";
import { SellerLine } from "@/components/SellerLine";
import { QuoteDocMoney } from "@/components/QuoteDocMoney";
import { quoteDocView } from "@/lib/sellers";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { expectedPaymentDays } from "@/lib/pay-behavior";
import { financingOf, getFinanceRate } from "@/lib/financing";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, dayInput, daysBetween } from "@/lib/domain";
import { buildQuote, costOf, quoteInclude, quoteNo, saleOf } from "@/lib/quote";
import { quoteFloor } from "@/lib/esagara-gate";
import { gateOf } from "@/lib/esagara-rules";
import { scopeState } from "@/lib/scope";
import { EXC_ERR, EXC_OK, ExceptionCard } from "../../comercial/esagara/ExceptionCard";
import { Popovers } from "@/components/Popovers";
import {
  applyMarketRate, completeQuote, createRevision, markDeclined, presentQuote, recommendScenario, removeLine, removeScenario,
  saveCosts, saveLine, saveScenario, saveSolution, saveTerms, waitWithControl,
} from "../actions";
import { registerPo } from "../../po/actions";
import { lineAmount, mulMoney, subMoney, sumMoney } from "@/lib/money";
import { BASE_CURRENCY, rateGapPct, rateText } from "@/lib/currencies";
import { marketRate, rateSourceText } from "@/lib/fx-market";
import { CostFxFields } from "@/components/CostFxFields";
import { CostTotal } from "@/components/CostTotal";
import { ProductRows } from "@/components/ProductRows";
import { Info } from "@/components/Info";
import { OpenOnLand } from "@/components/OpenOnLand";
import { COST_LINES, costDetail, esagaraPctOf, priceIncludes, productsCost, seedUnitCosts } from "@/lib/cost-lines";
import { COST_STATUS, costStatusOf, quoteDiff, weakest, type QV } from "@/lib/proposal-rules";

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; cmp?: string; abrir?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const [q, policy, pos, dealInvoices] = await Promise.all([
    db.quote.findUnique({ where: { id }, include: quoteInclude }),
    quoteFloor(id),
    db.customerPO.findMany({ where: { quoteId: id }, orderBy: { receivedAt: "desc" }, select: { id: true, number: true, receivedAt: true, rejectedAt: true, acceptance: { select: { id: true } } } }),
    db.invoice.findMany({ where: { deal: { quotes: { some: { id } } } }, orderBy: { issuedAt: "asc" }, select: { id: true, number: true, amount: true, issuedAt: true } }),
  ]);
  if (!q) notFound();
  const scope = q.status === "DRAFT" ? await scopeState(q.dealId, q.lines.map((l) => ({ code: l.code, description: l.description })), q) : null;
  const B = buildQuote(q, i, { ...policy, approvedBy: policy.exception?.status === "APPROVED" && !policy.outside ? policy.exception.decidedByName : null }, scope);
  const gate = gateOf(saleOf(q.lines), costOf(q), policy.policy);
  const [pay, rate, prevQ, paidRows, spoAgg] = await Promise.all([
    expectedPaymentDays(q.deal.accountId), getFinanceRate(),
    // C5 §20: the version right before this one, to show what changed (the older one is never rewritten).
    q.rev > 0 ? db.quote.findFirst({ where: { number: q.number, rev: { lt: q.rev } }, orderBy: { rev: "desc" }, include: { lines: { orderBy: { position: "asc" } } } }) : null,
    // C5 §15: Final = real money to the supplier (executed payments), once accepted.
    q.status === "ACCEPTED" ? db.supplierPayment.findMany({ where: { supplierPo: { dealId: q.dealId }, executedAt: { not: null } }, select: { amount: true, currency: true, amountUsd: true } }) : [],
    q.status === "ACCEPTED" ? db.supplierPO.findMany({ where: { dealId: q.dealId }, select: { amount: true, currency: true } }) : [],
  ]);
  const d = q.deal;
  const foreignCost = q.costCurrency !== BASE_CURRENCY;
  // Saved market rate (refreshed behind when old): the page never waits on Yahoo.
  const mkt = foreignCost ? await marketRate(q.costCurrency, { wait: false }) : null;
  const editable = canEdit(user, d.ownerId);
  const draft = q.status === "DRAFT";
  const docView = await quoteDocView(q, q.deal.sellerKey);
  const poCop = docView.money.currency === "COP";
  const siblings = d.quotes.filter((x) => x.number === q.number);
  const latest = siblings[siblings.length - 1];
  const todayStr = dayInput(B.now);
  const contact = d.contact ? `${d.contact.firstName} ${d.contact.lastName}` : null;

  const statusSig = {
    DRAFT: { c: "dash", x: t("Borrador interno", "Internal draft") },
    PRESENTED: { c: "info", x: t(`Presentada ${i.day(q.presentedAt)}`, `Presented ${i.day(q.presentedAt)}`) },
    SUPERSEDED: { c: "wait", x: t("Reemplazada por una revisión", "Replaced by a revision") },
    ACCEPTED: { c: "ok", x: t(`Aceptada ${i.day(q.decidedAt)}`, `Accepted ${i.day(q.decidedAt)}`) },
    DECLINED: { c: "wait", x: t("No aceptada", "Not accepted") },
  }[q.status];

  const okMsg: Record<string, string> = {
    completa: t("Guardado. Mira arriba qué falta todavía; cuando no falte nada aparece «Presentar al cliente».", "Saved. Look above for what is still missing; once nothing is missing, “Present to customer” appears."),
    correo: t("Correo enviado al cliente desde la cuenta de la empresa. Quedó registrado en la Necesidad.", "Email sent to the customer from the company account. It's logged on the Need."),
    creada: t("Cotización creada con los productos y costos de la Necesidad.", "Quote created from the Need's products and costs."),
    abierta: t("Ya había un borrador abierto: es este.", "There was already an open draft: this one."),
    solucion: t("Solución y promesa guardadas.", "Solution and promise saved."),
    costos: t("Costos guardados. SOLU recalculó la economía esperada.", "Costs saved. SOLU recalculated the expected economics."),
    "costos-precio": t("Costos guardados. SOLU puso el precio de venta en los productos según la Eságara que escribiste: revísalo en «PRODUCTOS EN EL DOCUMENTO».", "Costs saved. SOLU put the sale price on the products from the Eságara you typed: check it under “PRODUCTS ON THE DOCUMENT”."),
    "tasa-mercado": t("Tasa actualizada a la del mercado. SOLU recalculó la economía esperada.", "Rate updated to the market's. SOLU recalculated the expected economics."),
    condiciones: t("Condiciones guardadas.", "Terms saved."),
    vendedor: t("Empresa que vende actualizada.", "Selling company updated."),
    moneda: t("Moneda e IVA guardados.", "Currency and IVA saved."),
    linea: t("Productos actualizados.", "Products updated."),
    escenario: t("Escenarios actualizados.", "Scenarios updated."),
    recomendado: t("Escenario recomendado: el plazo de la cotización lo sigue.", "Scenario recommended: the quote's lead time follows it."),
    presentada: t("Presentada. La economía quedó protegida y esta versión ya no cambia. Ahora el foco es cómo decide el cliente.", "Presented. Economics are protected and this version no longer changes. Now the focus is how the customer decides."),
    revision: t("Revisión creada con el mismo número. La versión presentada queda intacta.", "Revision created with the same number. The presented version stays intact."),
    aceptada: t("Aceptada. La OC quedó en la Necesidad; ya se puede facturar al entregar.", "Accepted. The PO is on the Need; it can be invoiced on delivery."),
    rechazada: t("Registrado: el cliente no aceptó.", "Recorded: the customer did not accept."),
    espera: t("Esperando con control. SOLU lo devuelve a Mi Día en la fecha indicada.", "Waiting with control. SOLU brings it back to My Day on the given date."),
    ...EXC_OK(t),
  };
  const errMsg: Record<string, string> = {
    tasa: t("No se pudo consultar la TRM oficial ahora. Intenta de nuevo o escribe la tasa con su motivo.", "Couldn't get the official TRM right now. Try again, or type the rate with its reason."),
    "tasa-rango": t("Escribe una tasa válida (pesos por dólar).", "Type a valid rate (pesos per dollar)."),
    "tasa-motivo": t("Si escribes otra tasa, di por qué.", "If you type another rate, say why."),
    exento: t("Para marcarla exenta de IVA, escribe el motivo.", "To mark it IVA exempt, write the reason."),
    "doc-seller-inactive": t("La empresa que vende no está activa. Gerencia la activa en Comercial → Configuración → Empresas que venden.", "The selling company isn't active. Management activates it in Commercial → Setup → Selling companies."),
    "doc-seller-incomplete": t("Faltan datos legales de la empresa que vende; no se puede presentar así.", "The selling company's legal details are incomplete; it can't be presented like this."),
    "doc-cop-not-allowed": t("Esta empresa no cotiza en pesos: cambia la moneda a USD.", "This company doesn't quote in pesos: change the currency to USD."),
    "doc-no-rate": t("La cotización está en pesos y no tiene tasa fijada: guárdala en «Moneda e IVA del documento».", "The quote is in pesos and has no fixed rate: save it under “Document currency and IVA”."),
    "doc-exempt-no-reason": t("Falta el motivo de la exención de IVA.", "The IVA exemption reason is missing."),
    "vendedor-inactivo": t("Esa empresa aún no está activa: Gerencia debe completar sus datos en Comercial → Configuración → Empresas que venden.", "That company isn't active yet: Management must complete its details in Commercial → Setup → Selling companies."),
    "vendedor-fijo": t("El cliente ya vio una cotización de esta empresa (o hay factura): la empresa que vende ya no cambia en esta Necesidad.", "The customer already saw a quote from this company (or there's an invoice): the seller no longer changes on this Need."),
    permiso: t("No tienes permiso para cambiar esta Necesidad.", "You don't have permission to change this Need."),
    presentada: t("Esta versión ya fue presentada y no cambia. Crea una revisión.", "This version was already presented and doesn't change. Create a revision."),
    bloqueada: t("Todavía hay puntos que impiden presentarla (ver «Lista para presentar»).", "There are still items that block presenting it (see “Ready to Present”)."),
    "sin-oc": t("Escribe el número de OC del cliente.", "Write the customer's PO number."),
    espera: t("Escribe qué esperas y hasta cuándo.", "Write what you're waiting for and until when."),
    estado: t("Esta acción no aplica en el estado actual.", "This action doesn't apply in the current state."),
    "tasa-mercado": t("No se pudo consultar la tasa del mercado ahora. Intenta de nuevo en un minuto, o escribe la tasa del banco con su fuente en «Liquidación de costos».", "Couldn't get the market rate right now. Try again in a minute, or type the bank's rate with its source in “Cost settlement”."),
    "credito-fuente": t("Escribiste un crédito a favor: di de dónde sale (nota crédito, saldo con el transportador). No se guardó nada todavía.", "You typed a credit in our favor: say where it comes from (credit note, balance with the carrier). Nothing was saved yet."),
    "motivo-costo": t("Un costo bajó: escribe por qué en la casilla «¿Por qué bajó el costo?», debajo del total de «Liquidación de costos» (por ejemplo, nueva proforma). No se guardó nada todavía. Así nadie sube la Eságara quitando costos reales.", "A cost went down: write why in the “Why did the cost go down?” box, under the total of “Cost settlement” (e.g., new proforma). Nothing was saved yet. That way nobody lifts Eságara by removing real costs."),
    ...EXC_ERR(t),
  };

  const QA = ({ label, children, wide, right, cls = "", popCls = "", open }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; right?: boolean; cls?: string; popCls?: string; open?: boolean }) => (
    <details className={`qa ${cls}`} open={open || undefined}>
      <summary className="qa-btn">{label}</summary>
      <div className={`qa-pop${wide ? " wide" : ""}${right ? " right" : ""}${popCls ? ` ${popCls}` : ""}`}>{children}</div>
    </details>
  );
  const money = (v: number | null | undefined) => (v == null ? "—" : `USD ${i.n2(v)}`);
  const pdf = (lang: "EN" | "ES") => `/documentos/cotizacion/${q.id}?lang=${lang}`;
  // Every point is a link to the place where it is filled in (on a draft; a presented version no longer changes).
  const Check = ({ ok, text, fix, href, optional }: { ok: boolean; text: string; fix?: string; href?: string; optional?: boolean }) => (
    <li className={ok ? "ok" : optional ? "no info" : "no"}>
      <span className="ic" aria-hidden>{ok ? "✓" : optional ? "·" : "!"}</span>
      <span>{href && (draft || !href.startsWith("#")) ? <a className="chk-a" href={href} title={t("Ir a donde se llena", "Go to where it is filled in")}>{text} <span aria-hidden>→</span></a> : text}{!ok && fix && <span className="src block">{fix}</span>}</span>
    </li>
  );

  // ---------- Header ----------
  const Header = () => (
    <header className="jh">
      <div className="jh-top">
        <p className="crumb k"><MarkNeed id={d.id} label={d.code ?? ""} /><Link href={`/deals/${d.id}?tab=quote`}>{d.code ?? t("Necesidad", "Need")}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
        <span className="jid">Quote Nº {quoteNo(q)}</span>
        <span className="grow" />
        <div className="jh-act">
          <a className="qa-btn" href={pdf(q.lang)} target="_blank" rel="noopener">{t("Ver PDF", "View PDF")} ({q.lang})</a>
          <a className="qa-btn" href={pdf(q.lang === "EN" ? "ES" : "EN")} target="_blank" rel="noopener">{q.lang === "EN" ? "ES" : "EN"}</a>
          <Link className="qa-btn" href={`/deals/${d.id}/solucion`}>{t("Caso de solución", "Solution Case")}</Link>
          <a className="qa-btn" href={`/documentos/propuesta/${q.id}?lang=${q.lang}`} target="_blank" rel="noopener">{t("Propuesta", "Proposal")}</a>
          {editable && !draft && q.status !== "SUPERSEDED" && <Link className="qa-btn" href={`/correo/nuevo?tpl=OFFER&id=${q.id}`}>{t("Enviar al cliente por correo", "Email to customer")}</Link>}
          {editable && !draft && q.status !== "SUPERSEDED" && q.status !== "ACCEPTED" && (
            <form action={createRevision.bind(null, q.id)}><button type="submit" className="qa-btn">{t("Crear revisión", "Create revision")}</button></form>
          )}
          {!draft && ["Presentar al cliente", "Agregar", "Guardar costos", "Agregar escenario", "Recomendar este"].map((b) => (
            <GuideWhy key={b} button={b}>{t(`«${b}» ya no aparece: esta versión de la cotización ya se presentó y no cambia. Para cambiarla se usa «Crear revisión», aquí arriba.`, `“${b}” is no longer shown: this version of the quote was already presented and doesn't change. To change it use “Create revision”, up here.`)}</GuideWhy>
          ))}
        </div>
      </div>
      <div className="jh-title">
        <h1>{d.title}</h1>
        <span className={`sig ${statusSig.c}`}>{statusSig.x}</span>
      </div>
      <p className="jh-sub">{contact ? `${contact} · ` : ""}{t("Responsable", "Owner")}: {d.owner.name}{d.desiredResult ? ` · ${t("Resultado del cliente", "Customer result")}: ${d.desiredResult}` : ""}</p>
      {siblings.length > 1 && (
        <nav className="qv-revs" aria-label={t("Versiones", "Versions")}>
          {siblings.map((s) => (
            <Link key={s.id} href={`/cotizaciones/${s.id}`} className={`qv-rev${s.id === q.id ? " on" : ""}`}>
              {s.rev === 0 ? t("Original", "Original") : `Rev. ${s.rev}`}
              <small>{s.status === "DRAFT" ? t("borrador", "draft") : s.status === "SUPERSEDED" ? t("reemplazada", "replaced") : s.status === "PRESENTED" ? t("presentada", "presented") : s.status === "ACCEPTED" ? t("aceptada", "accepted") : t("no aceptada", "declined")}</small>
            </Link>
          ))}
        </nav>
      )}
    </header>
  );

  // ---------- What to write in each field (the "i" next to its name) ----------
  const HELP = {
    desiredResult: { text: t("Lo que el cliente quiere lograr con esta compra, dicho como lo diría él. No es el producto: es para qué lo quiere.", "What the customer wants to achieve with this purchase, in their words. Not the product: what they want it for."), example: t("Que la línea 2 no pare por la bomba", "Line 2 never stops because of the pump") },
    solution: { text: t("Una sola frase que diga qué logra el cliente con lo que le cotizamos. No es la lista de productos.", "One sentence saying what the customer achieves with what we quote. Not the product list."), example: t("Bomba nueva para que la línea 2 dosifique sin paradas", "New pump so line 2 doses without stops") },
    supplyPrimary: { text: t("A quién le vamos a comprar y desde dónde: marca, proveedor y origen. Sirve para que el equipo sepa de dónde sale. Se puede dejar vacío.", "Who we will buy from and from where: brand, supplier and origin. It tells the team where it comes from. It can be left empty."), example: t("ProMinent, distribuidor en Miami, en stock", "ProMinent, distributor in Miami, in stock") },
    supplyAlt: { text: t("Un segundo proveedor u otra opción por si el principal falla. Se puede dejar vacío.", "A second supplier or another option in case the main one fails. It can be left empty."), example: t("Fábrica en Alemania, 8 semanas", "Factory in Germany, 8 weeks") },
    promiseText: { text: t("Lo que le podemos prometer al cliente sobre la entrega, en una frase corta.", "What we can promise the customer about delivery, in a short sentence."), example: t("Entrega en 4 a 6 semanas", "Delivery in 4 to 6 weeks") },
    promiseCondition: { text: t("De qué depende que podamos cumplir esa promesa. Se puede dejar vacío.", "What our keeping that promise depends on. It can be left empty."), example: t("Si la OC llega antes del viernes", "If the PO arrives before Friday") },
    supplierCost: { text: t("Lo que nos cobra el proveedor por el producto, en dólares, sin envío ni impuestos (esos van abajo, en «Liquidación de costos»).", "What the supplier charges us for the product, in dollars, without shipping or taxes (those go below, under “Cost settlement”)."), example: "900" },
    supplierSrc: { text: t("El documento o mensaje que respalda ese costo: quién lo dio y cuándo.", "The document or message behind that cost: who gave it and when."), example: t("Proforma 1234 del proveedor, 15 de noviembre", "Supplier proforma 1234, 15 November") },
    lead: { text: t("En cuántos días entregamos, contados desde el día en que llega la OC del cliente. Un mínimo y un máximo.", "In how many days we deliver, counted from the day the customer's PO arrives. A minimum and a maximum."), example: t("28 y 42 (de 4 a 6 semanas)", "28 and 42 (4 to 6 weeks)") },
    price: { text: t("El precio de venta de una unidad de este producto, en dólares.", "The selling price of one unit of this product, in dollars."), example: "1400" },
  };

  // ---------- Complete to present: one form with only what is missing ----------
  const Complete = () => {
    if (!draft || !editable) return null;
    const noPrice = q.lines.filter((l) => !(Number(l.unitPrice) > 0));
    const usd = q.costCurrency === BASE_CURRENCY;
    const m = {
      result: !d.desiredResult, solution: !q.solution, promise: !q.promiseText,
      cost: !(Number(q.supplierCost) > 0), src: !q.supplierSrc,
      lead: q.leadMinDays == null || q.leadMaxDays == null,
    };
    const count = [m.cost, m.lead, noPrice.length > 0].filter(Boolean).length;
    const optCount = [m.result, m.solution, m.src, m.promise].filter(Boolean).length;
    // Things a field cannot fix here: no products at all, unclear scope, Eságara under the policy threshold.
    const others = [
      ...(q.lines.length === 0 ? [{ text: t("Agregar al menos un producto", "Add at least one product"), how: t("Abajo, en PRODUCTOS EN EL DOCUMENTO → «Agregar producto»", "Below, under PRODUCTS ON THE DOCUMENT → “Add product”"), href: "#lineas" }] : []),
      ...B.blocking.filter((c) => c.tab === "scope").map((c) => ({ text: c.text, how: c.fix ?? "", href: `/deals/${d.id}/alcance` })),
      ...B.blocking.filter((c) => c.tab === "costs" && !m.cost).map((c) => ({ text: c.text, how: c.fix ?? "", href: "#costos" })),
    ];
    if (count === 0 && others.length === 0 && optCount === 0) {
      return (
        <section className="cq done" id="completar">
          <span className="ic" aria-hidden>✓</span>
          <span className="cq-t"><b>{t("Esta cotización tiene todo lo necesario", "This quote has everything it needs")}</b><span>{t("Revisa el PDF si quieres y preséntala: desde ahí ya no cambia y se puede registrar la OC del cliente.", "Check the PDF if you like and present it: from then on it does not change and the customer's PO can be recorded.")}</span></span>
          <a className="btn" href="#presentar">{t("Ir a «Presentar al cliente»", "Go to “Present to customer”")} →</a>
        </section>
      );
    }
    const Req = () => <span className="req-tag">{t("Falta", "Missing")}</span>;
    return (
      <section className={`cq${count + others.length === 0 ? " ready" : ""}`} id="completar">
        <div className="cq-head">
          <b>{count + others.length === 0 ? t("LISTA PARA PRESENTAR", "READY TO PRESENT") : t("COMPLETA PARA PRESENTAR", "COMPLETE TO PRESENT")}</b>
          {count + others.length === 0
            ? <><span className="sig ok">{t("No falta nada obligatorio", "Nothing required is missing")}</span><span className="grow" /><a className="btn sm" href="#presentar">{t("Ir a «Presentar al cliente»", "Go to “Present to customer”")} →</a></>
            : <span className="sig risk">{count + others.length === 1 ? t("Falta 1 cosa", "1 thing missing") : t(`Faltan ${count + others.length} cosas`, `${count + others.length} things missing`)}</span>}
        </div>
        {count + others.length === 0 ? <p className="cq-sub">{t("Ya puedes presentarla. Abajo quedan datos opcionales por si quieres agregarlos.", "You can present it now. Optional items remain below in case you want to add them.")}</p> : <p className="cq-sub">{t("Para presentar solo hacen falta tres cosas: el precio de cada producto, el costo del producto y el tiempo de entrega. Llena lo que está en rojo y guarda; la «i» junto a cada nombre explica qué escribir.", "To present, only three things are needed: the price of every product, the product's cost and the lead time. Fill in what is in red and save; the “i” next to each name explains what to write.")}{noPrice.length > 0 && <> {t("El precio también puede salir solo: escribe la Eságara que quieres ganar en", "The price can also come out by itself: type the Eságara you want to earn in")} <a href="#costos">«{t("Liquidación de costos", "Cost settlement")}»</a>.</>}</p>}
        {(count > 0 || optCount > 0) && (
          <form action={completeQuote.bind(null, q.id)} className="cq-form">
            {noPrice.map((l) => <label key={l.id} className="req-miss"><span className="fname">{t("Precio de venta por unidad (USD)", "Selling price per unit (USD)")}: {l.description.slice(0, 60)} <Info lang={user.lang} {...HELP.price} /> <Req /></span><input name={`price_${l.id}`} type="number" min="0" step="0.01" placeholder={HELP.price.example} /></label>)}
            {m.cost && usd && q.lines.length > 1 && <p className="small req-miss" style={{ margin: 0 }}><span className="fname">{t(`Costo de cada producto (son ${q.lines.length})`, `Cost of each product (there are ${q.lines.length})`)} <Req /></span> <a className="btn secondary sm" href="#productos-costo">{t("Escribirlo en la hoja de costos, una fila por producto", "Type it on the cost sheet, one row per product")} ↓</a></p>}
            {m.cost && usd && q.lines.length <= 1 && <label className="req-miss"><span className="fname">{t("Costo del producto (USD)", "Product cost (USD)")} <Info lang={user.lang} {...HELP.supplierCost} /> <Req /></span><input name="supplierCost" type="number" min="0" step="0.01" placeholder={HELP.supplierCost.example} /></label>}
            {m.cost && !usd && <p className="cq-note wide">{t(`El costo del producto está en ${q.costCurrency}: escríbelo abajo, en «Liquidación de costos».`, `The product's cost is in ${q.costCurrency}: type it below, under “Cost settlement”.`)} <a href="#costos">{t("Ir a la hoja de costos", "Go to the cost sheet")} →</a></p>}
            {m.lead && (
              <div className="cq-pair">
                <span className="fname">{t("Tiempo de entrega: días después de recibir la OC", "Lead time: days after receiving the PO")} <Info lang={user.lang} {...HELP.lead} /> <Req /></span>
                <label className="req-miss">{t("Mínimo", "Minimum")}<input name="leadMinDays" type="number" min="0" step="1" defaultValue={q.leadMinDays ?? ""} placeholder="28" /></label>
                <label className="req-miss">{t("Máximo", "Maximum")}<input name="leadMaxDays" type="number" min="0" step="1" defaultValue={q.leadMaxDays ?? ""} placeholder="42" /></label>
              </div>
            )}
            {optCount > 0 && (
              <details className="cq-opt wide">
                <summary>{t(`Opcional: ${optCount} dato(s) más que mejoran la cotización (no hacen falta para presentar)`, `Optional: ${optCount} more item(s) that improve the quote (not needed to present)`)}</summary>
                <div className="cq-form">
                  {m.result && <label className="wide"><span className="fname">{t("Resultado que busca el cliente", "Result the customer wants")} <Info lang={user.lang} {...HELP.desiredResult} /></span><input name="desiredResult" maxLength={300} placeholder={HELP.desiredResult.example} /></label>}
                  {m.solution && <label className="wide"><span className="fname">{t("La solución en una frase", "The solution in one sentence")} <Info lang={user.lang} {...HELP.solution} /></span><input name="solution" maxLength={400} placeholder={HELP.solution.example} /></label>}
                  {m.src && <label><span className="fname">{t("De dónde sale ese costo", "Where that cost comes from")} <Info lang={user.lang} {...HELP.supplierSrc} /></span><input name="supplierSrc" maxLength={200} placeholder={HELP.supplierSrc.example} /></label>}
                  {m.promise && <label><span className="fname">{t("Promesa posible: qué entrega le prometemos", "Possible promise: what delivery we promise")} <Info lang={user.lang} {...HELP.promiseText} /></span><input name="promiseText" maxLength={300} placeholder={HELP.promiseText.example} /></label>}
                  {m.promise && <label><span className="fname">{t("Condición de la promesa (opcional)", "Promise condition (optional)")} <Info lang={user.lang} {...HELP.promiseCondition} /></span><input name="promiseCondition" maxLength={300} placeholder={HELP.promiseCondition.example} /></label>}
                </div>
              </details>
            )}
            <div className="cq-foot wide"><button type="submit">{t("Guardar lo que llené", "Save what I filled in")}</button></div>
          </form>
        )}
        {others.length > 0 && (
          <ul className="sn-list">
            {others.map((o, k) => (
              <li key={k} className="no"><span className="ic" aria-hidden>!</span><span className="sn-t"><b>{o.text}</b>{o.how && <span className="sn-how">{o.how}</span>}</span><a className="btn sm" href={o.href}>{t("Ir allá", "Go there")} →</a></li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  // ---------- Solution ----------
  const Solution = () => (
    <section className="jblock" id="solucion" data-open-on-land>
      <div className="jbh"><b>{t("SOLUCIÓN", "SOLUTION")}</b><span className="grow" />
        {editable && draft && (
          <QA label={t("Editar", "Edit")} wide right>
            <form action={saveSolution.bind(null, q.id)} className="qa-form">
              <label><span className="fname">{t("La solución en una frase (qué logra el cliente)", "The solution in one sentence (what the customer achieves)")} <Info lang={user.lang} {...HELP.solution} /></span><textarea name="solution" rows={2} maxLength={400} defaultValue={q.solution ?? ""} placeholder={HELP.solution.example} /></label>
              <label><span className="fname">{t("De dónde lo conseguimos: proveedor principal (opcional)", "Where we get it: main supplier (optional)")} <Info lang={user.lang} {...HELP.supplyPrimary} /></span><input name="supplyPrimary" maxLength={300} defaultValue={q.supplyPrimary ?? ""} placeholder={HELP.supplyPrimary.example} /></label>
              <label><span className="fname">{t("Proveedor alternativo (opcional)", "Alternative supplier (optional)")} <Info lang={user.lang} {...HELP.supplyAlt} /></span><input name="supplyAlt" maxLength={300} defaultValue={q.supplyAlt ?? ""} placeholder={HELP.supplyAlt.example} /></label>
              <label><span className="fname">{t("Promesa posible: qué entrega le prometemos", "Possible promise: what delivery we promise")} <Info lang={user.lang} {...HELP.promiseText} /></span><input name="promiseText" maxLength={300} defaultValue={q.promiseText ?? ""} placeholder={HELP.promiseText.example} /></label>
              <label><span className="fname">{t("Condición de la promesa (opcional)", "Promise condition (optional)")} <Info lang={user.lang} {...HELP.promiseCondition} /></span><input name="promiseCondition" maxLength={300} defaultValue={q.promiseCondition ?? ""} placeholder={HELP.promiseCondition.example} /></label>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </QA>
        )}
      </div>
      {q.solution ? <p className="qv-sol">{q.solution}</p> : <p className="quiet-p">{t("Escribe en una frase qué logra el cliente con esta cotización. No es la lista de productos.", "Write in one sentence what the customer achieves with this quote. Not the product list.")}</p>}
      <dl className="qv-dl">
        <dt>{t("Necesidad", "Need")}</dt><dd>{d.needSpecs ? d.needSpecs.split("\n")[0] : "—"}</dd>
        <dt>{t("Resultado que protege", "Result it protects")}</dt><dd>{d.desiredResult ?? <span className="attn-t">{t("Sin escribir", "Not written")}</span>}</dd>
        <dt>{t("De dónde lo conseguimos", "Where we get it")}</dt><dd>{q.supplyPrimary ?? "—"}{q.supplyAlt && <span className="src block">{t("Alternativa", "Alternative")}: {q.supplyAlt}</span>}</dd>
        <dt>{t("Promesa posible", "Possible promise")}</dt>
        <dd>{q.promiseText ? <><b>{q.promiseText}</b>{q.promiseCondition && <span className="qv-cond">{t("Condición", "Condition")}: {q.promiseCondition}</span>}</> : "—"}</dd>
      </dl>
    </section>
  );

  // ---------- Collection days (§10.4): agreed vs what history says ----------
  const PayLine = () => (pay ? <p className="small" style={{ marginTop: 10 }}>{t("Hábitos de pago del cliente", "Customer payment habits")}: {t(`plazo pactado ${pay.contractualDays} d`, `${pay.contractualDays}-day agreed terms`)}{pay.expectedDays != null ? <> · {t(`según historial ${pay.expectedDays} d`, `history says ${pay.expectedDays} d`)}{pay.deltaDays ? <b className={pay.deltaDays > 0 ? "attn-t" : ""}> ({pay.deltaDays > 0 ? "+" : ""}{pay.deltaDays} {t("días de financiación", "days of financing")})</b> : null}<span className="src"> · {t(`promedio de ${pay.n} factura(s) cobrada(s) y conciliada(s)${pay.enough ? "" : ", orientativo"}`, `average of ${pay.n} collected and reconciled invoice(s)${pay.enough ? "" : ", indicative"}`)} · <Link href={`/mercado/empresas/${q.deal.accountId}#pagos`}>{t("cómo paga", "how they pay")}</Link></span></> : <span className="src"> · {t("sin historial de cobro todavía", "no collection history yet")}</span>}</p> : null);

  // ---------- Financing cost (decision 2026-11-10): shown next to Eságara; the gate keeps today's formula ----------
  const finSale = q.status === "DRAFT" ? B.sale : B.curSale;
  const fin = financingOf({ sale: finSale, esagra: q.status === "DRAFT" ? B.esagra : B.curEsagra, expectedDays: pay?.expectedDays ?? null, contractualDays: pay?.contractualDays ?? q.deal.account.paymentTermsDays, annualPct: rate.annualPct });
  const FinLine = () => (finSale > 0 ? (
    <p className="small" style={{ marginTop: 4 }}>
      {t("Financiación", "Financing")}: {fin.rateMissing
        ? <span className="src">{t("falta la tasa del costo del dinero (la definen Finanzas o Gerencia en Cupos de crédito)", "the cost-of-money rate is missing (Finance or Management set it in Credit limits)")} · <Link href="/administracion/cupos#costo-dinero">{t("ir", "go")}</Link></span>
        : <>
            <b>{money(fin.cost)}</b> {t(`por ${fin.days} días a ${i.pct2(fin.annualPct)} anual`, `for ${fin.days} days at ${i.pct2(fin.annualPct)} a year`)}{fin.lateCost > 0.005 && <span className="attn-t"> ({t(`${money(fin.lateCost)} por los ${fin.lateDays} días que suele pagar tarde`, `${money(fin.lateCost)} for the ${fin.lateDays} days they usually pay late`)})</span>}
            {" "}· {t("Eságara después de financiar", "Eságara after financing")}: <b>{money(fin.esagraAfter)}</b> ({i.pct(fin.pctAfter)})
            <span className="src block">{fin.basis === "HISTORY" ? t("Días según cómo paga este cliente (dinero conciliado).", "Days from how this customer pays (reconciled cash).") : t("Sin historial de pagos: se usan los días del plazo pactado.", "No payment history: the agreed terms are used.")} {t("Informativo: el umbral de Eságara no incluye la financiación.", "Informational: the Eságara threshold doesn't include financing.")}</span>
          </>}
    </p>
  ) : null);

  // ---------- Economics ----------
  const Economics = () => {
    const v = B.versions;
    const showVersions = v.length > 1;
    const cur = v.find((x) => x.current) ?? v[0];
    const det = costDetail(q);
    const used = (get: (x: (typeof v)[number]) => number) => v.some((x) => Math.abs(get(x)) > 0.004);
    // The settlement in the order the team works. "Otros" and the credit only show when they have a value.
    const rows: { k: string; label: string; src: string | null; sub?: boolean; minus?: boolean; get: (x: (typeof v)[number]) => number }[] = [
      { k: "supplier", label: t("Producto (proveedor)", "Product (supplier)"), src: q.supplierSrc, get: (x) => x.supplier },
      { k: "freight", label: t("Envío (transporte)", "Shipping (transport)"), src: [q.freightSrc, q.transitDays != null ? t(`${q.transitDays} días de transporte`, `${q.transitDays} transit days`) : null].filter(Boolean).join(" · ") || null, get: (x) => x.freight },
      ...COST_LINES.filter((c) => c.k !== "misc" || used((x) => x.detail.misc)).map((c) => ({ k: c.k, label: t(c.es, c.en), src: q.otherSrc, sub: true, get: (x: (typeof v)[number]) => x.detail[c.k] })),
      ...(used((x) => x.detail.credit) ? [{ k: "credit", label: t("Crédito a favor (resta)", "Credit in our favor (subtracts)"), src: q.creditSrc, sub: true, minus: true, get: (x: (typeof v)[number]) => x.detail.credit }] : []),
    ];
    const otherGross = sumMoney([cur.other, det.credit]);
    const st: Record<string, string> = {
      supplier: costStatusOf(q.supplierStatus, cur.supplier, q.supplierSrc, q.supplyConfirmed),
      freight: costStatusOf(q.freightStatus, cur.freight, q.freightSrc),
      // No other costs typed is a valid answer (nothing to pay), not a pending one.
      ...(otherGross > 0 ? { other: costStatusOf(q.otherStatus, otherGross, q.otherSrc) } : {}),
    };
    const weak = weakest(Object.values(st));
    const prev = v.length > 1 ? v[v.findIndex((x) => x.current) - 1] : undefined;
    const why = q.changeNote;
    // Supplier paid in its own currency: the quote's rate next to the market's, and what the difference is worth.
    const savedRate = q.fxRate ? Number(q.fxRate) : null;
    const mktGap = mkt && savedRate ? rateGapPct(mkt.usdPerUnit, savedRate) : 0;
    const mktDelta = mkt && savedRate ? subMoney(mulMoney(q.supplierCost, mkt.usdPerUnit), mulMoney(q.supplierCost, savedRate)) : 0;
    const mktMoved = Math.abs(mktGap) >= 0.01;
    // Cost settlement sheet: on a draft the costs are typed right here, like a spreadsheet (no pop-up).
    const canSheet = editable && draft;
    const showTable = !canSheet || showVersions;
    const srcLabel = t("De dónde sale", "Where it is from");
    const prodSeed = seedUnitCosts(q.lines, q.supplierCost);
    // A cost typed before any product existed becomes the first row, so the total is not lost.
    const prodRows = q.lines.length === 0 && Number(q.supplierCost) > 0
      ? [{ id: "", qty: 1, code: null as string | null, description: q.deal.title, unitCost: Number(q.supplierCost) as number | null, unitPrice: 0 }]
      : q.lines.map((l, n) => ({ id: l.id, qty: l.qty, code: l.code, description: l.description, unitCost: prodSeed.costs[n], unitPrice: Number(l.unitPrice) }));
    const Sheet = () => (
      <form action={saveCosts.bind(null, q.id)} className="liq-sheet" id="costos">
        <div className="liq-head">
          <b>{t("Liquidación de costos", "Cost settlement")}</b>
          <span className="src">{t("Primero los productos, uno por fila, con lo que cobra el proveedor por cada uno; después los costos de traerlos, cada uno en su fila (lo que no aplique se deja en 0). Abajo escribes la Eságara que quieres ganar y SOLU calcula el precio de venta mientras escribes.", "First the products, one per row, with what the supplier charges for each; then the costs of bringing them, each on its row (leave at 0 what doesn't apply). Below you type the Eságara you want to earn and SOLU calculates the sale price as you type.")}</span>
        </div>
        <ProductRows lang={user.lang} what="quote" items={prodRows} seeded={prodSeed.seeded} />
        <div className="liq-grid">
          <span className="liq-th">{t("Concepto", "Item")}</span><span className="liq-th r">{t("Valor", "Amount")}</span><span className="liq-th">{t("¿De dónde sale?", "Where is it from?")}</span>

          <label htmlFor="lq-supplierCost" className="liq-name">{t("Productos", "Products")}<small>{t("lo que cobra el proveedor por todos, en su moneda: la suma de las filas de arriba", "what the supplier charges for all of them, in its currency: the sum of the rows above")}</small></label>
          <input id="lq-supplierCost" className="liq-val" name="supplierCost" type="number" readOnly tabIndex={-1} defaultValue={productsCost(prodRows)} />
          <input className="liq-src" name="supplierSrc" maxLength={200} defaultValue={q.supplierSrc ?? ""} aria-label={`${srcLabel}: ${t("producto", "product")}`} placeholder={t("Proforma, correo del proveedor…", "Proforma, supplier email…")} />
          <div className="liq-wide"><CostFxFields lang={user.lang} currency={q.costCurrency} rate={q.fxRate ? Number(q.fxRate) : null} source={q.fxSource} /></div>

          <label htmlFor="lq-freightCost" className="liq-name">{t("Envío", "Shipping")}<small>{t("transporte hasta el cliente, en USD", "transport to the customer, in USD")}</small></label>
          <input id="lq-freightCost" className="liq-val" name="freightCost" type="number" step="0.01" min="0" defaultValue={Number(q.freightCost)} />
          <input className="liq-src" name="freightSrc" maxLength={200} defaultValue={q.freightSrc ?? ""} aria-label={`${srcLabel}: ${t("envío", "shipping")}`} placeholder={t("Cotización de DHL, transportador…", "DHL quote, carrier…")} />

          <label htmlFor="lq-transitDays" className="liq-name">{t("Días de transporte", "Transit days")}<small>{t("cuántos días viaja la mercancía", "how many days the goods travel")}</small></label>
          <input id="lq-transitDays" className="liq-val" name="transitDays" type="number" step="1" min="0" max="365" defaultValue={q.transitDays ?? ""} />
          <span className="liq-src src">{t("días · no es un costo", "days · not a cost")}</span>

          {COST_LINES.flatMap((c, n) => [
            <label key={`${c.k}-l`} htmlFor={`lq-${c.name}`} className="liq-name">{t(c.es, c.en)}<small>{t(c.hintEs, c.hintEn)}, {t("en USD", "in USD")}</small></label>,
            <input key={`${c.k}-v`} id={`lq-${c.name}`} className="liq-val" name={c.name} type="number" step="0.01" min="0" defaultValue={Math.max(0, det[c.k])} />,
            ...(n === 0 ? [
              <div key="osrc" className="liq-src liq-span">
                <input name="otherSrc" maxLength={200} defaultValue={q.otherSrc ?? ""} aria-label={`${srcLabel}: ${t("impuestos, aduana, empaque, giro y otros", "taxes, customs, packing, bank wire and other")}`} placeholder={t("Agencia de aduana, banco…", "Customs broker, bank…")} />
                <small>{t("Una sola respuesta para impuestos, aduana, empaque, giro y otros.", "One answer for taxes, customs, packing, bank wire and other.")}</small>
              </div>,
            ] : []),
          ])}

          <label htmlFor="lq-creditAmount" className="liq-name minus">{t("Crédito a favor", "Credit in our favor")}<small>{t("saldo a favor con el proveedor o el transportador, en USD: se resta", "balance in our favor with the supplier or the carrier, in USD: subtracted")}</small></label>
          <input id="lq-creditAmount" className="liq-val" name="creditAmount" type="number" step="0.01" min="0" defaultValue={det.credit} />
          <input className="liq-src" name="creditSrc" maxLength={200} defaultValue={q.creditSrc ?? ""} aria-label={`${srcLabel}: ${t("crédito a favor", "credit in our favor")}`} placeholder={t("Nota crédito, saldo con el transportador…", "Credit note, balance with the carrier…")} />
        </div>
        <CostTotal lang={user.lang} sale={B.sale} pct={B.cost > 0 ? esagaraPctOf(B.sale, B.cost) : null} lines={q.lines.length} threshold={policy.threshold} saved={{ supplier: cur.supplier, freight: cur.freight, other: otherGross }} note={q.changeNote} askAlways={q.rev > 0} />
        <div className="liq-foot">
          <button type="submit">{t("Guardar costos", "Save costs")}</button>
          <span className="src">{t("Al guardar, SOLU guarda los productos de las filas y le pone a cada uno su precio de venta según la Eságara que escribiste.", "On save, SOLU saves the products of the rows and gives each one its sale price from the Eságara you typed.")}</span>
        </div>
        <p className="small" style={{ margin: 0 }}>{t("En el PDF del cliente", "On the customer's PDF")}: <b>{t("El precio incluye", "Price includes")}:</b> {priceIncludes(q, user.lang === "EN" ? "EN" : "ES")}. <span className="src">{t("Sale de los costos de esta hoja que tienen valor. El cliente ve los nombres, nunca nuestros costos ni la Eságara.", "It comes from the costs on this sheet that have an amount. The customer sees the names, never our costs or the Eságara.")}</span></p>
      </form>
    );
    return (
      <section className="jblock">
        <div className="jbh"><b>{t("ECONOMÍA", "ECONOMICS")}</b><span className="grow" />
        </div>

        <div className="qv-econ">
          <div className={`qv-box prot${q.protSale == null ? " pending" : ""}`}>
            <span className="k">{t("Economía protegida", "Protected economics")}</span>
            {q.protSale == null ? (
              <><b className="tv muted">—</b><span className="src">{t("Se fija al presentar. Después no cambia, aunque cambien los costos.", "Fixed when presenting. It doesn't change afterwards, even if costs change.")}</span></>
            ) : (
              <><b className="tv">{money(Number(q.protEsagra))}</b><span className="tsub">{i.pct((Number(q.protEsagra) / Number(q.protSale)) * 100)} {t("de", "of")} {money(Number(q.protSale))}</span><span className="src">{t(`Fijada el ${i.day(q.presentedAt)} · política v${q.protPolicy ?? "—"}`, `Fixed on ${i.day(q.presentedAt)} · policy v${q.protPolicy ?? "—"}`)}</span></>
            )}
          </div>
          <div className={`qv-box cur${B.econAlert || B.belowFloor ? " alert" : ""}`}>
            <span className="k">{t("Economía esperada actual", "Current expected economics")}</span>
            <b className="tv">{money(draft ? B.esagra : B.curEsagra)}</b>
            <span className="tsub">{i.pct(draft ? B.pct : B.curPct)} {t("de", "of")} {money(draft ? B.sale : B.curSale)}</span>
            <span className="src">{draft ? t("Se recalcula con cada cambio.", "Recalculated with every change.") : B.econChanged ? t(`Los costos cambiaron desde la presentación: ${money(B.currentCost)} hoy.`, `Costs changed since presenting: ${money(B.currentCost)} today.`) : t("Sin cambios de costo desde la presentación.", "No cost changes since presenting.")}</span>
          </div>
          <div className="qv-box pol">
            <span className="k">{t("Política comercial", "Commercial policy")}</span>
            <b className="tv">≥ {i.pct2(policy.threshold)}</b>
            <span className="src">{t(`Umbral de Eságara · política v${policy.version}. Por debajo se presenta solo con una excepción aprobada.`, `Eságara threshold · policy v${policy.version}. Below it, it's presented only with an approved exception.`)}{policy.floorPct < policy.threshold && ` ${t(`Con la excepción aprobada, esta versión se cubre hasta ${i.pct2(policy.floorPct)}.`, `With the approved exception, this version is covered down to ${i.pct2(policy.floorPct)}.`)}`}</span>
          </div>
        </div>
        {canSheet && <Sheet />}
        <PayLine />
        <FinLine />
        {B.econAlert && !draft && <p className="qv-alert">{t("Los costos de hoy dejan la Eságara por debajo del umbral. Lo presentado no cambia; revisa con el proveedor o crea una revisión.", "Today's costs leave Eságara below the threshold. What was presented doesn't change; check with the supplier or create a revision.")}</p>}
        <ExceptionCard quoteId={q.id} i={i} user={user} editable={editable} draft={draft} gate={gate} threshold={policy.threshold} exception={policy.exception} outside={policy.outside} />

        {showTable && canSheet && <p className="small" style={{ marginTop: 14 }}><b>{t("Comparación con las versiones anteriores", "Comparison with earlier versions")}</b></p>}
        {showTable && (
        <div className="tscroll" style={{ marginTop: canSheet ? 4 : 14 }}>
          <table className="qv-cost">
            <thead>
              <tr>
                <th>{t("Costo puesto en destino", "Landed cost")}</th>
                {showVersions ? v.map((x) => <th key={x.id} className={`n${x.current ? " cur" : ""}`}>{x.rev === 0 ? t("Original", "Original") : `Rev. ${x.rev}`}</th>) : <th className="n">USD</th>}
                <th>{t("Fuente", "Source")}</th>
                <th>{t("Firmeza", "Firmness")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k} className={r.sub ? "sub" : undefined}>
                  <td>{r.label}</td>
                  {(showVersions ? v : v.filter((x) => x.current)).map((x) => {
                    const p = prev && x.current ? r.get(prev) : null;
                    const changed = p != null && Math.abs(p - r.get(x)) > 0.5;
                    return <td key={x.id} className={`n val${x.current ? " cur" : ""}${changed ? " chg" : ""}`}>{r.minus && r.get(x) > 0 ? "− " : ""}{i.n2(r.get(x))}{changed && <span className="delta">{r.get(x) > p! ? "▲" : "▼"} {i.n2(Math.abs(r.get(x) - p!))}</span>}</td>;
                  })}
                  <td className="src">{r.get(cur) > 0 ? (r.src ?? <span className="attn-t">{t("sin fuente", "no source")}</span>) : r.k === "freight" && r.src ? r.src : "—"}</td>
                  <td>{st[r.k] ? <span className={`sig ${COST_STATUS[st[r.k]].tone}`}>{t(COST_STATUS[st[r.k]].es, COST_STATUS[st[r.k]].en)}</span> : null}</td>
                </tr>
              ))}
              <tr className="tot">
                <td>{t("Total costo", "Total cost")}</td>
                {(showVersions ? v : v.filter((x) => x.current)).map((x) => <td key={x.id} className={`n val${x.current ? " cur" : ""}`}>{i.n2(x.supplier + x.freight + x.other)}</td>)}
                <td /><td><span className={`sig ${COST_STATUS[weak].tone}`}>{t(COST_STATUS[weak].es, COST_STATUS[weak].en)}</span></td>
              </tr>
              <tr>
                <td>{t("Venta", "Sale")}</td>
                {(showVersions ? v : v.filter((x) => x.current)).map((x) => <td key={x.id} className={`n val${x.current ? " cur" : ""}`}>{i.n2(x.sale)}</td>)}
                <td /><td />
              </tr>
              <tr className="tot">
                <td>Eságara</td>
                {(showVersions ? v : v.filter((x) => x.current)).map((x) => { const e = x.sale - x.supplier - x.freight - x.other; return <td key={x.id} className={`n val${x.current ? " cur" : ""}`}>{i.n2(e)}<span className="src block">{x.sale > 0 ? i.pct((e / x.sale) * 100) : "—"}</span></td>; })}
                <td /><td />
              </tr>
            </tbody>
          </table>
        </div>
        )}
        <p className="src" style={{ marginTop: 6 }}>{t(`La Eságara es tan firme como su costo menos firme: ${COST_STATUS[weak].es.toLowerCase()}. La financiación se muestra aparte y no entra en el umbral.`, `Eságara is only as firm as its least firm cost: ${COST_STATUS[weak].en.toLowerCase()}. Financing is shown separately and isn't part of the threshold.`)}</p>
        {why && <p className="qv-why"><b>{t("Por qué cambió", "Why it changed")}:</b> {why}</p>}
        {!foreignCost ? (
          <p className="src" style={{ marginTop: 8 }}>{t("Sin exposición cambiaria: proveedor y cliente en USD.", "No FX exposure: supplier and customer in USD.")}</p>
        ) : (
          <div className="note" style={{ marginTop: 8 }}>
            {savedRate == null ? (
              <p className="small risk-t">{t(`Falta la tasa: el costo del proveedor está en ${q.costCurrency} y hoy se está sumando como si fueran dólares.`, `The rate is missing: the supplier's cost is in ${q.costCurrency} and today it's being added as if it were dollars.`)}</p>
            ) : (
              <p className="small">
                {t("Proveedor", "Supplier")}: <b className="mono">{q.costCurrency} {i.n2(Number(q.supplierCost))}</b> × <b className="mono">{rateText(savedRate)}</b> = <b className="mono">{money(cur.supplier)}</b>
                <span className="src block">{t(`Tasa de la cotización: 1 ${q.costCurrency} = ${rateText(savedRate)} USD · ${q.fxSource ?? "fuente sin registrar"}`, `Quote rate: 1 ${q.costCurrency} = ${rateText(savedRate)} USD · ${q.fxSource ?? "source not recorded"}`)}</span>
              </p>
            )}
            {mkt ? (
              <p className="small">
                {t("Mercado ahora", "Market now")}: <b className="mono">1 {q.costCurrency} = {rateText(mkt.usdPerUnit)} USD</b> <span className="muted">(1 USD = {mkt.unitsPerUsd >= 100 ? i.n2(mkt.unitsPerUsd) : mkt.unitsPerUsd.toFixed(4)} {q.costCurrency})</span>
                {savedRate != null && (mktMoved
                  ? <> · <span className={mktDelta > 0 ? "attn-t" : undefined}>{t(`a esta tasa el proveedor costaría ${money(Math.abs(mktDelta))} ${mktDelta > 0 ? "más" : "menos"} (${i.pct(Math.abs(mktGap))})`, `at this rate the supplier would cost ${money(Math.abs(mktDelta))} ${mktDelta > 0 ? "more" : "less"} (${i.pct(Math.abs(mktGap))})`)}</span></>
                  : <> · {t("igual a la tasa de la cotización", "same as the quote's rate")}</>)}
                <span className="src block">{rateSourceText(mkt)}{mkt.stale ? ` · ${t("lectura vieja: el mercado no respondió hoy", "old reading: the market didn't answer today")}` : ""} · {t("referencia de mercado; la tasa del banco el día del pago puede variar.", "market reference; the bank's rate on payment day can differ.")}</span>
              </p>
            ) : (
              <p className="src">{t(`Sin tasa de mercado para ${q.costCurrency} por ahora.`, `No market rate for ${q.costCurrency} right now.`)}</p>
            )}
            {editable && draft && mkt && (savedRate == null || mktMoved) && (
              <form action={applyMarketRate.bind(null, q.id)}><button type="submit" className="secondary">{t("Actualizar a la tasa del mercado", "Update to the market rate")}</button></form>
            )}
            {!draft && savedRate != null && <p className="src">{t("Lo presentado no cambia. Si la tasa se mueve antes de pagar al proveedor, cambia la eságara real.", "What was presented doesn't change. If the rate moves before paying the supplier, the real eságara changes.")}</p>}
          </div>
        )}
      </section>
    );
  };

  // ---------- Scenarios (optional) ----------
  const Scenarios = () => {
    const sc = q.scenarios;
    if (sc.length === 0 && !(editable && draft)) return null;
    const rec = sc.find((s) => s.recommended);
    return (
      <section className="jblock">
        <div className="jbh"><b>{t("ESCENARIOS", "SCENARIOS")}</b><span>{t("opcional · solo si ayudan a decidir", "optional · only if they help decide")}</span><span className="grow" />
          {editable && draft && (
            <QA label={t("+ Escenario", "+ Scenario")} wide right>
              <ScenarioForm />
            </QA>
          )}
        </div>
        {sc.length === 0 ? <p className="quiet-p">{t("Sin escenarios. Agrégalos solo si el cliente gana algo al comparar (más rápido, más barato).", "No scenarios. Add them only if the customer gains something by comparing (faster, cheaper).")}</p> : (
          <>
            <div className="qv-scen" style={{ gridTemplateColumns: `140px repeat(${sc.length}, minmax(150px, 1fr))` }}>
              <div className="h" />
              {sc.map((s) => <div key={s.id} className={`h${s.recommended ? " rec" : ""}`}><b>{s.label}</b>{s.recommended && <span className="sig info">{t("Recomendado", "Recommended")}</span>}</div>)}
              <div className="k">{t("Precio", "Price")}</div>
              {sc.map((s) => <div key={s.id} className={`v mono${s.recommended ? " rec" : ""}`}>{money(Number(s.price))}</div>)}
              <div className="k">{t("Entrega", "Delivery")}</div>
              {sc.map((s) => <div key={s.id} className={`v${s.recommended ? " rec" : ""}`}>{s.leadMinDays}–{s.leadMaxDays} {t("días", "days")}<span className="src block">{i.day(addDays(B.now, s.leadMinDays))} – {i.day(addDays(B.now, s.leadMaxDays))}</span></div>)}
              <div className="k">Eságara</div>
              {sc.map((s) => { const e = Number(s.price) - Number(s.cost); const p = Number(s.price) > 0 ? (e / Number(s.price)) * 100 : null; const low = policy.floorPct != null && p != null && p < policy.floorPct; return <div key={s.id} className={`v mono${s.recommended ? " rec" : ""}${low ? " low" : ""}`}>{i.pct(p)}{low && <span className="src block">{t("bajo el piso", "below floor")}</span>}</div>; })}
              <div className="k">{t("Riesgo", "Risk")}</div>
              {sc.map((s) => <div key={s.id} className={`v${s.recommended ? " rec" : ""}`}>{s.risk ?? "—"}</div>)}
              <div className="k">{t("Promesa", "Promise")}</div>
              {sc.map((s) => <div key={s.id} className={`v${s.recommended ? " rec" : ""}`}>{s.promise ?? "—"}</div>)}
              {editable && draft && <div className="k" />}
              {editable && draft && sc.map((s) => (
                <div key={s.id} className={`v act${s.recommended ? " rec" : ""}`}>
                  {!s.recommended && <form action={recommendScenario.bind(null, q.id, s.id)}><button type="submit" className="link small">{t("Recomendar este", "Recommend this")}</button></form>}
                  <form action={removeScenario.bind(null, q.id, s.id)}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>
                </div>
              ))}
            </div>
            {rec?.why && <p className="ai-note" style={{ marginTop: 10 }}>{t("Por qué SOLU recomienda", "Why SOLU recommends")} «{rec.label}»: {rec.why}</p>}
          </>
        )}
      </section>
    );
  };
  const ScenarioForm = () => (
    <form action={saveScenario.bind(null, q.id, null)} className="qa-form">
      <label>{t("Nombre", "Name")}<input name="label" required maxLength={60} placeholder={t("Más rápido / Recomendado / Más económico", "Faster / Recommended / Cheaper")} /></label>
      <div className="qa-row"><label>{t("Precio USD", "Price USD")}<input name="price" type="number" min="0" step="0.01" required /></label><label>{t("Costo USD", "Cost USD")}<input name="cost" type="number" min="0" step="0.01" required /></label></div>
      <div className="qa-row"><label>{t("Días mín.", "Min days")}<input name="leadMinDays" type="number" min="0" required /></label><label>{t("Días máx.", "Max days")}<input name="leadMaxDays" type="number" min="0" required /></label></div>
      <label>{t("Riesgo", "Risk")}<input name="risk" maxLength={200} /></label>
      <label>{t("Promesa posible", "Possible promise")}<input name="promise" maxLength={200} /></label>
      <label>{t("Por qué lo recomendarías (si aplica)", "Why you'd recommend it (if so)")}<input name="why" maxLength={300} /></label>
      <button type="submit">{t("Agregar escenario", "Add scenario")}</button>
    </form>
  );

  // ---------- Lines ----------
  const Lines = () => (
    <section className="jblock" id="lineas">
      <div className="jbh"><b>{t("PRODUCTOS EN EL DOCUMENTO", "PRODUCTS ON THE DOCUMENT")} · {q.lines.length}</b><span className="grow" /><span className="src">Total USD {i.n2(B.sale)}</span></div>
      <div className="tscroll">
        <table>
          <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Costo unit. (interno)", "Unit cost (internal)")}{q.costCurrency !== "USD" ? ` ${q.costCurrency}` : ""}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th className="n">Total</th>{editable && draft && <th />}</tr></thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.id}>
                <td className="val">{l.qty}</td><td className="mono small">{l.code ?? "—"}</td><td>{l.description}</td>
                <td className="n val">{l.unitCost != null ? i.n2(l.unitCost) : draft ? <a className="attn-t small" href="#productos-costo">{t("sin costo", "no cost")}</a> : "—"}</td>
                <td className={`n val${Number(l.unitPrice) <= 0 ? " attn-t" : ""}`}>{Number(l.unitPrice) > 0 ? i.n2(l.unitPrice) : t("sin precio", "no price")}</td>
                <td className="n val">{i.n2(lineAmount(l.qty, l.unitPrice))}</td>
                {editable && draft && (
                  <td className="nowrap">
                    <QA label={t("Editar", "Edit")} right>
                      <form action={saveLine.bind(null, q.id, l.id)} className="qa-form">
                        <div className="qa-row"><label>{t("Cant.", "Qty")}<input name="qty" type="number" min="1" defaultValue={l.qty} /></label><label>{t("Código", "Code")}<input name="code" defaultValue={l.code ?? ""} /></label></div>
                        <label>{t("Descripción", "Description")}<input name="description" defaultValue={l.description} required /></label>
                        <label>{t("Precio unit. USD", "Unit price USD")}<input name="unitPrice" type="number" min="0" step="0.01" defaultValue={Number(l.unitPrice)} /></label>
                        <button type="submit">{t("Guardar", "Save")}</button>
                      </form>
                    </QA>
                    <form action={removeLine.bind(null, q.id, l.id)} style={{ display: "inline" }}><button type="submit" className="link small">{t("Quitar", "Remove")}</button></form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && draft && (
        <details style={{ marginTop: 10 }}>
          <summary>{t("Agregar producto", "Add product")}</summary>
          <form action={saveLine.bind(null, q.id, null)} className="inline">
            <label>{t("Cant.", "Qty")}<input name="qty" type="number" min="1" defaultValue="1" required style={{ width: 70 }} /></label>
            <label>{t("Código", "Code")}<input name="code" style={{ width: 140 }} /></label>
            <label style={{ flex: 1 }}>{t("Descripción", "Description")}<input name="description" required /></label>
            <label>{t("Precio unit. USD", "Unit price USD")}<input name="unitPrice" type="number" min="0" step="0.01" style={{ width: 120 }} /></label>
            <button type="submit">{t("Agregar", "Add")}</button>
          </form>
        </details>
      )}
    </section>
  );

  // ---------- Terms + decision ----------
  const Terms = () => (
    <section className="jblock" id="condiciones" data-open-on-land>
      <div className="jbh"><b>{t("CONDICIONES DEL DOCUMENTO", "DOCUMENT TERMS")}</b><span className="grow" /><span className="src">{t("Idioma del documento", "Document language")}: {q.lang}</span></div>
      <dl className="qv-dl">
        <dt>Lead Time</dt><dd>{B.leadText ?? <span className="attn-t">{t("Sin definir", "Not set")}</span>}<span className="src block">{t("Calculado desde los días después de la OC; no se escribe a mano.", "Calculated from days after PO; never typed by hand.")}</span></dd>
        <dt>Shipping Terms</dt><dd>{q.incoterm ?? "—"}</dd>
        <dt>Payment Due</dt><dd>{q.paymentTerms ?? "—"}</dd>
        <dt>Validity</dt><dd>{t(`${q.validityDays} días`, `${q.validityDays} days`)} {draft ? <span className="src">{t("(corren desde que se presenta)", "(run from presenting)")}</span> : `(${t("hasta", "until")} ${i.date(B.offerUntil)})`}</dd>
        <dt>Condition</dt><dd>{q.condition}</dd>
        <dt>Bill to</dt><dd className="pre">{q.billTo ?? "—"}</dd>
        <dt>Ship to</dt><dd className="pre">{q.shipTo ?? "—"}</dd>
      </dl>
      {editable && draft && (
        <details style={{ marginTop: 10 }}>
          <summary>{t("Editar condiciones", "Edit terms")}</summary>
          <TermsForm />
        </details>
      )}
    </section>
  );
  const TermsForm = ({ decisionOnly = false }: { decisionOnly?: boolean }) => (
    <form action={saveTerms.bind(null, q.id)} className="stack jform">
      {!decisionOnly && (
        <>
          <div className="qa-row">
            <label>{t("Idioma del documento", "Document language")}<select name="lang" defaultValue={q.lang}><option value="EN">English</option><option value="ES">Español</option></select></label>
            <label>{t("Días mín. después de OC", "Min days after PO")} <Info lang={user.lang} {...HELP.lead} /><input name="leadMinDays" type="number" min="0" defaultValue={q.leadMinDays ?? ""} /></label>
            <label>{t("Días máx.", "Max days")}<input name="leadMaxDays" type="number" min="0" defaultValue={q.leadMaxDays ?? ""} /></label>
          </div>
          <div className="qa-row">
            <label>Incoterm<input name="incoterm" defaultValue={q.incoterm ?? ""} placeholder="DAP Bogotá" /></label>
            <label>Payment terms<input name="paymentTerms" defaultValue={q.paymentTerms ?? ""} placeholder="Net 30" /></label>
            <label>{t("Vigencia (días)", "Validity (days)")}<input name="validityDays" type="number" min="1" defaultValue={q.validityDays} /></label>
            <label>Condition<input name="condition" defaultValue={q.condition} /></label>
          </div>
          <div className="qa-row">
            <label>Bill to<textarea name="billTo" rows={3} defaultValue={q.billTo ?? ""} /></label>
            <label>Ship to<textarea name="shipTo" rows={3} defaultValue={q.shipTo ?? ""} /></label>
          </div>
        </>
      )}
      <b className="small">{t("Cómo decide el cliente", "How the customer decides")}</b>
      <div className="qa-row">
        <label>{t("Momento de decisión", "Decision moment")}<input name="decisionLabel" maxLength={80} defaultValue={q.decisionLabel ?? ""} placeholder={t("Comité de compras", "Purchasing committee")} /></label>
        <label>{t("Fecha", "Date")}<input name="decisionAt" type="date" defaultValue={dayInput(q.decisionAt)} /></label>
      </div>
      <label>{t("Quién pide, quién recomienda, quién emite la OC", "Who asks, who recommends, who issues the PO")}<input name="decisionPath" maxLength={400} defaultValue={q.decisionPath ?? ""} /></label>
      <label>{t("Evidencia (quién lo dijo y cuándo)", "Evidence (who said it and when)")}<input name="decisionEvidence" maxLength={300} defaultValue={q.decisionEvidence ?? ""} /></label>
      <div className="qa-row">
        <label>{t("Vigencia del proveedor hasta", "Supplier validity until")}<input name="supplierValidUntil" type="date" defaultValue={dayInput(q.supplierValidUntil)} /></label>
        <label>{t("La promesa se sostiene si decide antes de", "Promise holds if they decide by")}<input name="promiseDecideBy" type="date" defaultValue={dayInput(q.promiseDecideBy)} /></label>
      </div>
      <label className="chk"><input type="checkbox" name="supplyConfirmed" value="1" defaultChecked={q.supplyConfirmed} /> {t("El proveedor confirmó disponibilidad y plazo", "Supplier confirmed availability and lead time")}</label>
      <button type="submit">{t("Guardar", "Save")}</button>
    </form>
  );

  // ---------- Rail before presenting ----------
  const ReadyRail = () => (
    <aside className="jrail">
      <div id="presentar" className="land">
        <div className="jbh"><b>{t("LISTA PARA PRESENTAR", "READY TO PRESENT")}</b><span className="grow" />{B.blocking.length === 0 ? <span className="sig ok">{t("Lista", "Ready")}</span> : <span className="sig attn">{t(`${B.blocking.length} pendiente(s)`, `${B.blocking.length} open`)}</span>}</div>
        <ul className="qv-checks">{B.ready.map((c, n) => <Check key={n} {...c} />)}</ul>
        <p className="src" style={{ marginTop: 6 }}><Link href={`/deals/${d.id}/alcance`}>{t("Técnico y alcance", "Technical & scope")}</Link>{scope && scope.state === "NOT_STARTED" ? ` · ${t("caso simple, nada que aclarar", "simple case, nothing to clarify")}` : ""}</p>
        {editable && B.blocking.length === 0 && (
          <form action={presentQuote.bind(null, q.id)} className="qa-form" style={{ marginTop: 12 }}>
            <div className="qa-row">
              <input name="presentedOn" type="date" defaultValue={todayStr} aria-label={t("Fecha", "Date")} />
              <input name="how" placeholder={t("Cómo (correo, reunión…)", "How (email, meeting…)")} maxLength={200} style={{ flex: 1 }} />
            </div>
            <button type="submit" className="wide">{t("Presentar al cliente", "Present to customer")}</button>
            <span className="src">{t("Crea la versión que ya no cambia y protege su economía. Descarga el PDF para enviarlo.", "Creates the version that no longer changes and protects its economics. Download the PDF to send it.")}</span>
          </form>
        )}
        {B.blocking.length > 0 && <GuideWhy button="Presentar al cliente">{t(`«Presentar al cliente» aparece aquí, debajo de la lista LISTA PARA PRESENTAR, cuando ningún punto tenga «!». Ahora hay ${B.blocking.length} pendiente(s): resuélvelos primero (cada uno dice qué hacer).`, `“Present to customer” shows here, under the READY TO PRESENT list, once no item has a “!”. There are ${B.blocking.length} open now: resolve them first (each one says what to do).`)}</GuideWhy>}
        {B.blocking.length === 0 && !editable && <GuideWhy button="Presentar al cliente">{t("La lista está completa, pero solo el responsable de esta Necesidad (o Dirección) puede presentar la cotización.", "The list is complete, but only the owner of this Need (or management) can present the quote.")}</GuideWhy>}
      </div>
      <div>
        <div className="jbh"><b>{t("SI EL CLIENTE DICE SÍ HOY", "READY IF CUSTOMER SAYS YES")}</b></div>
        <p className="src" style={{ marginBottom: 6 }}>{t("No impide presentar. Dice qué fallaría si aceptara ahora.", "Doesn't block presenting. Says what would fail if they accepted now.")}</p>
        <ul className="qv-checks soft">{B.ifYes.map((c, n) => <Check key={n} {...c} />)}</ul>
      </div>
      <div>
        <div className="jbh"><b>{t("CÓMO DECIDE", "HOW THEY DECIDE")}</b><span className="grow" />{editable && <QA label={t("Editar", "Edit")} wide right><TermsForm decisionOnly /></QA>}</div>
        <DecisionFacts />
      </div>
    </aside>
  );

  const DecisionFacts = () => (
    <dl className="qv-dl tight">
      <dt>{t("Decide", "Decides")}</dt><dd>{q.decisionLabel ? <b>{q.decisionLabel}</b> : "—"}{q.decisionAt && ` · ${i.dateShort(q.decisionAt)}`}</dd>
      <dt>{t("Camino", "Path")}</dt><dd>{q.decisionPath ?? <span className="muted">{t("Sin averiguar", "Not found out yet")}</span>}</dd>
      {q.decisionEvidence && <><dt>{t("Evidencia", "Evidence")}</dt><dd className="src">{q.decisionEvidence}</dd></>}
    </dl>
  );

  // ---------- Customer Decision Future ----------
  const Clocks = () => {
    const end = B.clocks.length ? B.clocks[B.clocks.length - 1].at : addDays(B.now, 14);
    const span = Math.max(7, daysBetween(B.now, end) + 2);
    const pos = (at: Date) => `${Math.min(100, Math.max(0, (daysBetween(B.now, at) / span) * 100))}%`;
    const days = Array.from({ length: span + 1 }, (_, n) => addDays(B.now, n));
    const kindLabel = { customer: t("Cliente", "Customer"), promise: t("Promesa", "Promise"), supplier: t("Proveedor", "Supplier"), offer: t("Oferta", "Offer") };
    return (
      <section className="jblock">
        <div className="jbh"><b>{t("VENTANA DE INFLUENCIA", "INFLUENCE WINDOW")}</b><span className="grow" />
          {B.windowEnd && <span className="src">{daysBetween(B.now, B.windowEnd) >= 0 ? t(`${daysBetween(B.now, B.windowEnd)} día(s) en los que una acción todavía cambia el resultado`, `${daysBetween(B.now, B.windowEnd)} day(s) where an action still changes the result`) : t("La ventana ya se cerró", "The window has closed")}</span>}
        </div>
        <div className="tl-wrap">
          <div className="qv-tl">
            <div className="qv-tl-days">
              {days.map((dd, n) => (n > 0 && n % Math.ceil(span / 10) === 0 && n / span < 0.95 ?<span key={n} style={{ left: pos(dd) }}>{i.weekday(dd)} {dd.getUTCDate()}</span> : null))}
            </div>
            <div className="qv-tl-track">
              {B.windowEnd && <span className="win" style={{ left: 0, width: pos(B.windowEnd) }} />}
              <span className="now" style={{ left: 0 }}><i>{t("Hoy", "Today")}</i></span>
              {B.clocks.map((c) => <span key={c.key} className={`mk ${c.kind}`} style={{ left: pos(c.at) }} title={`${c.label} · ${i.dateShort(c.at)}`} />)}
            </div>
          </div>
        </div>
        <div className="qv-clocks">
          {B.clocks.map((c) => {
            const left = daysBetween(B.now, c.at);
            return (
              <div key={c.key} className={`qv-clock ${c.kind}`}>
                <span className="k">{kindLabel[c.kind]}</span>
                <b>{c.label}</b>
                <span className="mono">{i.dateShort(c.at)}</span>
                <span className={`src${left < 0 ? " risk-t" : ""}`}>{left > 1 ? t(`en ${left} días`, `in ${left} days`) : left === 1 ? t("mañana", "tomorrow") : left === 0 ? t("hoy", "today") : t(`hace ${-left} días`, `${-left} days ago`)}</span>
              </div>
            );
          })}
        </div>
        <p className="src" style={{ marginTop: 8 }}>{t("Dos relojes que no se mezclan: la vigencia de la oferta (precio para el cliente) y la vigencia de la promesa (fecha de entrega que se puede sostener).", "Two clocks that never mix: offer validity (price for the customer) and promise validity (delivery date we can still hold).")}</p>
      </section>
    );
  };

  const DecisionRail = () => {
    const n = B.next;
    return (
      <aside className="jrail">
        {q.status === "PRESENTED" && n && (
          <div className="nm">
            <span className="k">{n.kind === "wait" ? t("ESPERANDO CON CONTROL", "WAITING WITH CONTROL") : t("SIGUIENTE MOVIMIENTO ÚTIL", "NEXT USEFUL MOVEMENT")}</span>
            <p className={`what${n.kind === "wait" ? " quiet" : ""}`}>{n.title}</p>
            <p className="why">{n.why}</p>
            {editable && (
              <div className="qa-bar">
                {n.kind !== "wait" && (
                  <QA label={t("Esperar con control", "Wait with control")} wide>
                    <form action={waitWithControl.bind(null, q.id)} className="qa-form">
                      <label>{t("¿Qué esperas?", "What are you waiting for?")}<input name="waitingFor" required maxLength={200} defaultValue={q.decisionLabel ? t(`Resultado de ${q.decisionLabel}`, `Outcome of ${q.decisionLabel}`) : ""} /></label>
                      <label>{t("SOLU lo devuelve el", "SOLU brings it back on")}<input name="waitingUntil" type="date" required defaultValue={dayInput(q.decisionAt ? addDays(q.decisionAt, 1) : addDays(B.now, 3))} /></label>
                      <button type="submit">{t("Guardar espera", "Save wait")}</button>
                    </form>
                  </QA>
                )}
                <Link className="qa-btn" href={`/deals/${d.id}`}>{t("Ver Necesidad", "Open Need")}</Link>
              </div>
            )}
          </div>
        )}
        {q.status === "PRESENTED" && editable && (
          <div id="respuesta" className="land">
            <div className="jbh"><b>{t("EL CLIENTE RESPONDIÓ", "THE CUSTOMER ANSWERED")}</b></div>
            <div className="qa-bar" style={{ borderTop: 0, paddingTop: 0 }}>
              <QA label={t("Llegó la PO · registrarla", "PO arrived · record it")} wide right open={sp.abrir === "po"}>
                <form action={registerPo.bind(null, q.id)} className="qa-form">
                  <b>{t("Tal como viene en la PO del cliente", "Exactly as on the customer's PO")}</b>
                  {poCop && <span className="src block">{t("La cotización salió en pesos: escribe los precios de la PO en pesos, antes de IVA. SOLU los compara con la tasa fijada en la cotización.", "The quote went out in pesos: type the PO prices in pesos, before IVA. SOLU compares them at the rate fixed on the quote.")}</span>}
                  <div className="qa-row"><label>{t("Número de PO", "PO number")}<input name="number" required maxLength={80} /></label><label>{t("Recibida", "Received")}<input name="receivedAt" type="date" defaultValue={todayStr} /></label></div>
                  <label>{t("Fecha de entrega que exige", "Delivery date it demands")}<input name="requiredBy" type="date" /></label>
                  {q.lines.map((l, n) => (
                    <div key={l.id} className="qa-row">
                      <label style={{ flex: "0 0 64px" }}>{t("Cant.", "Qty")}<input name={`qty_${n}`} type="number" min="0" defaultValue={l.qty} /></label>
                      <label>{l.code ?? t("Precio", "Price")}{poCop ? " · COP" : ""}<input name={`price_${n}`} type="number" min="0" step={poCop ? "1" : "0.01"} defaultValue={poCop ? docView.money.lines[n]?.unit ?? 0 : Number(l.unitPrice)} /></label>
                    </div>
                  ))}
                  <div className="qa-row"><label>Incoterm<input name="incoterm" defaultValue={q.incoterm ?? ""} /></label><label>{t("Pago", "Payment")}<input name="paymentTerms" defaultValue={q.paymentTerms ?? ""} /></label></div>
                  <label>{t("Cotización que cita", "Quote it cites")}<input name="quoteRef" defaultValue={`${quoteNo(q)}`} /></label>
                  <details><summary className="small">{t("Razón social, IVA, documentos, penalidades (si la PO los trae)", "Legal entity, VAT, documents, penalties (if the PO has them)")}</summary>
                    <div className="qa-row"><label>{t("Razón social", "Legal entity")}<input name="legalEntity" maxLength={160} /></label><label>{t("NIT / Tax ID", "Tax ID")}<input name="taxIdOnPo" maxLength={40} /></label></div>
                    <label>IVA<select name="ivaMode" defaultValue="NOT_STATED"><option value="NOT_STATED">{t("No indica", "Not stated")}</option><option value="ADDED">{t("IVA se suma", "VAT added")}</option><option value="INCLUDED">{t("Precio con IVA incluido", "Price includes VAT")}</option><option value="EXEMPT">{t("Exento", "Exempt")}</option></select></label>
                    <label>{t("Documentos exigidos", "Documents required")}<input name="documents" maxLength={400} /></label>
                    <label>{t("Penalidades", "Penalties")}<input name="penalties" maxLength={400} /></label>
                    <label>{t("Garantía exigida", "Warranty required")}<input name="warranty" maxLength={300} /></label>
                  </details>
                  <label>{t("Fuente", "Source")}<input name="source" maxLength={200} placeholder={t("Ej.: PDF adjunto en correo de Compras", "E.g.: PDF attached to Purchasing email")} /></label>
                  <button type="submit">{t("Registrar y comparar", "Record and compare")}</button>
                </form>
              </QA>
              <QA label={t("No aceptó", "Declined")} wide right>
                <form action={markDeclined.bind(null, q.id)} className="qa-form">
                  <label>{t("¿Por qué? (lo que dijo el cliente)", "Why? (what the customer said)")}<input name="why" maxLength={300} required /></label>
                  <label>{t("Fuente", "Source")}<input name="source" maxLength={200} /></label>
                  <button type="submit" className="secondary">{t("Registrar", "Record")}</button>
                </form>
              </QA>
            </div>
            <p className="src" style={{ marginTop: 6 }}>{t("Registrar la PO no la acepta: SOLU la compara primero con esta cotización. ¿Pide un cambio? Crea una revisión (arriba).", "Recording the PO doesn't accept it: SOLU first compares it with this quote. Asking for a change? Create a revision (top).")}</p>
          </div>
        )}
        {pos.length > 0 && (
          <div>
            <div className="jbh"><b>{t("PO RECIBIDAS", "POs RECEIVED")}</b></div>
            <ul className="plain">
              {pos.map((p) => (
                <li key={p.id}><Link href={`/po/${p.id}`} className="val">PO {p.number}</Link> · {i.day(p.receivedAt)} · {p.acceptance ? <span className="sig ok">{t("Aceptada", "Accepted")}</span> : p.rejectedAt ? <span className="sig wait">{t("No aceptada", "Not accepted")}</span> : <span className="sig attn">{t("Por comparar y decidir", "To compare and decide")}</span>}</li>
              ))}
            </ul>
          </div>
        )}
        {q.status === "ACCEPTED" && (
          <div>
            <div className="jbh"><b>{t("ACEPTADA", "ACCEPTED")}</b></div>
            <p className="small">{t("OC del cliente", "Customer PO")}: <b className="mono">{d.customerPo ?? "—"}</b></p>
            {dealInvoices.length === 0 ? <p className="src">{t("La factura nace al entregar: Operaciones → Entregado sin facturar.", "The invoice is born on delivery: Operations → Delivered, not invoiced.")}</p> : (
              <ul className="plain">{dealInvoices.map((inv) => <li key={inv.id}><a href={`/documentos/factura/${inv.id}`} target="_blank" rel="noopener" className="mono">Invoice {inv.number}</a> · USD {i.n2(inv.amount)}</li>)}</ul>
            )}
          </div>
        )}
        {q.status === "SUPERSEDED" && latest && latest.id !== q.id && (
          <div><p className="small">{t("Esta versión fue reemplazada.", "This version was replaced.")} <Link href={`/cotizaciones/${latest.id}`}>{t("Ir a la versión vigente", "Go to the current version")}</Link></p></div>
        )}
        <div>
          <div className="jbh"><b>{t("CÓMO DECIDE EL CLIENTE", "HOW THE CUSTOMER DECIDES")}</b><span className="grow" />{editable && q.status === "PRESENTED" && <QA label={t("Actualizar", "Update")} wide right><TermsForm decisionOnly /></QA>}</div>
          <DecisionFacts />
        </div>
        <div>
          <div className="jbh"><b>{t("SI DICE SÍ", "IF THEY SAY YES")}</b></div>
          <ul className="qv-checks soft">{B.ifYes.map((c, k) => <Check key={k} {...c} />)}</ul>
        </div>
      </aside>
    );
  };

  const Presented = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("LO QUE SE PRESENTÓ", "WHAT WAS PRESENTED")}</b><span className="grow" /><a className="src" href={pdf(q.lang)} target="_blank" rel="noopener">PDF</a></div>
      {q.solution && <p className="qv-sol sm">{q.solution}</p>}
      <dl className="qv-dl">
        <dt>{t("Total", "Total")}</dt><dd className="mono">USD {i.n2(saleOf(q.lines))} · {q.lines.length} {t("línea(s)", "line(s)")}</dd>
        <dt>{t("Promesa", "Promise")}</dt><dd>{q.promiseText ?? "—"}{q.promiseCondition && <span className="qv-cond">{t("Condición", "Condition")}: {q.promiseCondition}</span>}</dd>
        <dt>Lead Time</dt><dd>{B.leadText ?? "—"}</dd>
        <dt>{t("Oferta vigente hasta", "Offer valid until")}</dt><dd>{i.date(B.offerUntil)}</dd>
      </dl>
    </section>
  );

  const EconCompact = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("ECONOMÍA", "ECONOMICS")}</b><span className="grow" />{B.econAlert ? <span className="sig risk">{t("Cruzó el umbral de la política", "Crossed the policy threshold")}</span> : <span className="sig ok">{t("Dentro de la política", "Within policy")}</span>}</div>
      <div className={`qv-econ${q.status === "ACCEPTED" ? "" : " two"}`}>
        <div className="qv-box prot"><span className="k">{t("Protegida al presentar", "Protected at presenting")}</span><b className="tv">{money(Number(q.protEsagra ?? 0))}</b><span className="tsub">{i.pct(q.protSale ? (Number(q.protEsagra) / Number(q.protSale)) * 100 : null)}</span><span className="src">{t(`Política v${q.protPolicy ?? "—"} · ${i.day(q.presentedAt)}`, `Policy v${q.protPolicy ?? "—"} · ${i.day(q.presentedAt)}`)}</span></div>
        <div className={`qv-box cur${B.econAlert ? " alert" : ""}`}><span className="k">{t("Esperada hoy", "Expected today")}</span><b className="tv">{money(B.curEsagra)}</b><span className="tsub">{i.pct(B.curPct)}</span><span className="src">{B.econChanged ? t("Los costos cambiaron después de presentar.", "Costs changed after presenting.") : t("Sin cambios de costo.", "No cost changes.")}{q.protEsagra != null && Math.abs(B.curEsagra - Number(q.protEsagra)) > 0.5 && <> · Δ {money(B.curEsagra - Number(q.protEsagra))}</>}</span></div>
        {q.status === "ACCEPTED" && <FinalBox />}
      </div>
      <PayLine />
      <FinLine />
      <p className="src" style={{ marginTop: 8 }}>{t("SOLU solo avisa si se cruza el piso de la política o si cambia la promesa.", "SOLU only warns if the policy floor is crossed or the promise changes.")}</p>
    </section>
  );

  // ---------- C5 §20: what changed since the previous version (the older version is never rewritten) ----------
  const qvOf = (x: NonNullable<typeof prevQ> | typeof q): QV => ({
    lines: x.lines.map((l) => ({ code: l.code, description: l.description, qty: l.qty, unitPrice: Number(l.unitPrice) })),
    leadMinDays: x.leadMinDays, leadMaxDays: x.leadMaxDays, incoterm: x.incoterm, paymentTerms: x.paymentTerms, validityDays: x.validityDays,
    condition: x.condition, promiseText: x.promiseText, promiseCondition: x.promiseCondition, solution: x.solution, supplyPrimary: x.supplyPrimary,
  });
  const diff = prevQ ? quoteDiff(qvOf(prevQ), qvOf(q)) : null;
  const DiffBlock = () => (!diff || !prevQ ? null : (
    <section className="jblock" id="cambios">
      <div className="jbh"><b>{t(`QUÉ CAMBIÓ DESDE ${quoteNo(prevQ)}`, `WHAT CHANGED SINCE ${quoteNo(prevQ)}`)}</b><span className="grow" /><Link className="src" href={`/cotizaciones/${prevQ.id}`}>{t("ver esa versión", "open that version")}</Link></div>
      {diff.empty ? <p className="quiet-p">{t("Todavía igual a la versión anterior.", "Still the same as the previous version.")}</p> : (
        <>
          <div className="tscroll">
            <table className="qv-diff">
              <thead><tr><th>{t("Qué", "What")}</th><th>{t("Antes", "Before")}</th><th>{t("Ahora", "Now")}</th></tr></thead>
              <tbody>
                {diff.lines.map((l, k) => (
                  <tr key={`l${k}`}>
                    <td><span className="mono small">{l.key}</span> <span className={`sig ${l.kind === "ADDED" ? "ok" : l.kind === "REMOVED" ? "risk" : "info"}`}>{l.kind === "ADDED" ? t("agregada", "added") : l.kind === "REMOVED" ? t("quitada", "removed") : t("cambió", "changed")}</span></td>
                    <td className="mono small">{l.from ? `${l.from.qty} × ${i.n2(l.from.unitPrice)}` : "—"}</td>
                    <td className="mono small">{l.to ? `${l.to.qty} × ${i.n2(l.to.unitPrice)}` : "—"}</td>
                  </tr>
                ))}
                {diff.fields.map((f) => <tr key={f.field}><td>{t(f.label.es, f.label.en)}</td><td className="small">{f.from || "—"}</td><td className="small"><b>{f.to || "—"}</b></td></tr>)}
                {diff.totalFrom !== diff.totalTo && <tr className="tot"><td>Total USD</td><td className="mono">{i.n2(diff.totalFrom)}</td><td className="mono">{i.n2(diff.totalTo)}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="small" style={{ marginTop: 6 }}>{t("Motivo", "Reason")}: {q.changeNote ? q.changeNote : <span className="attn-t">{t("sin escribir — anótalo en «Liquidación de costos», debajo del total, para que quede con la versión", "not written — note it in “Cost settlement”, under the total, so it stays with the version")}</span>}</p>
        </>
      )}
    </section>
  ));

  // ---------- C5 §15: Final economics = real money paid to the supplier (+ freight/other still expected) ----------
  const paidUsd = paidRows.map((p) => (p.currency === "USD" ? Number(p.amount) : p.amountUsd != null ? Number(p.amountUsd) : null));
  const committedUsd = spoAgg.map((p) => (p.currency === "USD" ? Number(p.amount) : null));
  const paidTotal = sumMoney(paidUsd.filter((x): x is number => x != null));
  const fxUnknown = paidUsd.some((x) => x == null) || committedUsd.some((x) => x == null);
  const committedTotal = sumMoney(committedUsd.filter((x): x is number => x != null));
  const fullyPaid = !fxUnknown && committedTotal > 0 && paidTotal >= committedTotal - 0.5;
  const restCost = sumMoney([Number(d.freightCost) > 0 ? d.freightCost : q.freightCost, Number(d.otherCosts) > 0 ? d.otherCosts : q.otherCosts]);
  const finalEsagra = paidRows.length ? (B.curSale - paidTotal - restCost) : null;
  const FinalBox = () => (
    <div className={`qv-box${fullyPaid ? " prot" : " pending"}`}>
      <span className="k">{t("Final (real)", "Final (actual)")}</span>
      {finalEsagra == null ? <><b className="tv muted">—</b><span className="src">{t("Se completa al pagar al proveedor. No reescribe lo protegido.", "Fills in as the supplier is paid. It never rewrites what was protected.")}</span></> : (
        <><b className="tv">{money(finalEsagra)}</b><span className="tsub">{i.pct(B.curSale > 0 ? (finalEsagra / B.curSale) * 100 : null)}</span>
          <span className="src">{t(`Proveedor pagado ${money(paidTotal)}${committedTotal ? ` de ${money(committedTotal)} comprometido` : ""}; fletes y otros ${money(restCost)} todavía esperados.`, `Supplier paid ${money(paidTotal)}${committedTotal ? ` of ${money(committedTotal)} committed` : ""}; freight and other ${money(restCost)} still expected.`)}{fxUnknown ? ` ${t("Hay pagos en otra moneda sin valor en USD.", "Some payments in another currency have no USD value.")}` : ""}{q.protEsagra != null && <> · Δ {t("vs protegida", "vs protected")} {money(finalEsagra - Number(q.protEsagra))}</>}</span></>
      )}
    </div>
  );

  // ---------- Focus strip (top) for presented quotes ----------
  const Focus = () => {
    const n = B.next;
    if (!n || q.status !== "PRESENTED") return null;
    const cls = n.kind === "wait" ? "wait" : n.kind === "risk" ? "risk" : n.kind === "clarity" ? "clarity" : "move";
    return (
      <section className={`qv-focus ${cls}`}>
        <span className="k">{t("FUTURO DE LA DECISIÓN DEL CLIENTE", "CUSTOMER DECISION FUTURE")}</span>
        <div className="row">
          <b>{n.title}</b>
          <div className="chips">
            {B.clocks.filter((c) => c.kind !== "offer").map((c) => <span key={c.key} className={`qv-chip ${c.kind}`}>{c.kind === "customer" ? c.label : c.kind === "supplier" ? t("Vigencia proveedor", "Supplier validity") : t("Promesa", "Promise")} · {i.weekday(c.at)} {i.day(c.at)}</span>)}
          </div>
        </div>
        <p>{n.why}</p>
      </section>
    );
  };

  return (
    <div className="jw qv">
      <OpenOnLand />
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <Header />
      <SellerLine dealId={q.deal.id} sellerKey={q.deal.sellerKey} es={i.es} editable={editable} back={`/cotizaciones/${q.id}`} />
      <QuoteDocMoney q={q} sellerKey={q.deal.sellerKey} es={i.es} editable={editable} />
      {draft ? (
        <div className="jbody">
          <div className="jmain">
            <Complete />
            <DiffBlock />
            {/* The order the team works in: what the customer gets, the products, then the cost settlement. */}
            <Solution />
            <Lines />
            <Economics />
            <Scenarios />
            <Terms />
          </div>
          <ReadyRail />
        </div>
      ) : (
        <>
          <Focus />
          <div className="jbody">
            <div className="jmain">
              {q.status === "PRESENTED" && <Clocks />}
              <EconCompact />
              <Presented />
              <DiffBlock />
            </div>
            <DecisionRail />
          </div>
        </>
      )}
      <Popovers />
    </div>
  );
}
