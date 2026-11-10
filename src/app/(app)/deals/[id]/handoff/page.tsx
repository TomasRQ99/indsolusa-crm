import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { operationalHandoff } from "@/lib/ops-home";
import { sellerOf } from "@/lib/sellers";

// Operaciones O0 · Operational Handoff (module 11 §2.1): what Comercial already settled, assembled for whoever
// fulfils it. Read-only and derived: Operaciones never re-asks what the Journey already knows.

export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const h = await operationalHandoff(id);
  if (!h) notFound();
  const { d, po, quote, basis, dispatch, credit } = h;
  const seller = await sellerOf(d.sellerKey);
  const money = (v: unknown) => `USD ${i.n2(v)}`;
  const pct = quote?.protSale && Number(quote.protSale) > 0 ? (Number(quote.protEsagra) / Number(quote.protSale)) * 100 : null;
  const included = d.scopeLines.filter((l) => l.status !== "EXCLUDED");
  const excluded = d.scopeLines.filter((l) => l.status === "EXCLUDED");
  const none = <span className="muted">{t("No registrado", "Not recorded")}</span>;

  return (
    <div className="jw scp">
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=execute`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="grow" />
          {po ? <span className="sig ok">{t("PO aceptada", "PO accepted")}</span> : <span className="sig wait">{t("Sin PO aceptada", "No accepted PO")}</span>}
        </div>
        <div className="jh-title"><h1>{t("Entrega a Operaciones", "Handoff to Operations")}</h1></div>
        <p className="jh-sub">{d.title} · {t("lleva la relación", "relationship owner")}: {d.owner.name}</p>
      </header>
      {!po && <section className="jblock"><p className="quiet-p">{t("Este Journey aún no tiene una PO aceptada: Operaciones empieza cuando Comercial acepta el compromiso.", "This Journey has no accepted PO yet: Operations starts once Commercial accepts the commitment.")}</p></section>}

      <section className="jblock">
        <div className="jbh"><b>{t("QUÉ PROMETIMOS", "WHAT WE PROMISED")}</b></div>
        <dl className="qv-dl">
          <dt>{t("Resultado que busca el cliente", "Result the customer is after")}</dt><dd>{d.desiredResult ?? none}</dd>
          <dt>{t("Promesa al cliente", "Customer promise")}</dt><dd><b>{po?.acceptance?.promiseDate ? i.date(po.acceptance.promiseDate) : d.promisedDate ? i.date(d.promisedDate) : "—"}</b>{quote?.promiseText ? ` · ${quote.promiseText}` : ""}{quote?.promiseCondition && <span className="src block">{t("Supuesto", "Assumption")}: {quote.promiseCondition}</span>}</dd>
          <dt>{t("PO del cliente", "Customer PO")}</dt><dd>{po ? <><Link href={`/po/${po.id}`}>{po.number}</Link> · {t("aceptada", "accepted")} {i.day(po.acceptance!.acceptedAt)} · {po.acceptance!.acceptedByName}</> : none}</dd>
          <dt>{t("Empresa que vende", "Selling company")}</dt><dd>{seller.legalName || seller.key}</dd>
          <dt>{t("Cliente", "Customer")}</dt><dd>{po?.legalEntity ?? d.account.name}{d.account.taxId ? ` · ${d.account.taxId}` : ""}</dd>
          <dt>{t("Dónde y a quién se entrega", "Where and to whom")}</dt><dd className="pre">{dispatch?.destination ?? po?.shipTo ?? quote?.shipTo ?? d.account.address ?? "—"}{(dispatch?.contactName || d.contact) && <span className="block">{dispatch?.contactName ?? `${d.contact!.firstName} ${d.contact!.lastName}`}{(dispatch?.contactPhone ?? d.contact?.phone) ? ` · ${dispatch?.contactPhone ?? d.contact?.phone}` : ""}</span>}</dd>
          <dt>{t("Instrucción de despacho", "Dispatch instruction")}</dt><dd>{dispatch ? <><Link href={`/deals/${d.id}/despacho`}>v{dispatch.version}</Link>{dispatch.documents ? ` · ${dispatch.documents}` : ""}{dispatch.entryRequirement ? ` · ${dispatch.entryRequirement}` : ""}</> : <Link href={`/deals/${d.id}/despacho`}>{t("Sin emitir", "Not issued")}</Link>}</dd>
        </dl>
      </section>

      <section className="jblock">
        <div className="jbh"><b>{t("ALCANCE ACEPTADO", "ACCEPTED SCOPE")}</b><span className="grow" /><Link className="small" href={`/deals/${d.id}/alcance`}>{t("Ver alcance", "See scope")}</Link></div>
        {po && po.lines.length > 0 && <div className="tscroll"><table><thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th></tr></thead><tbody>{po.lines.map((l) => <tr key={l.id}><td className="val">{l.qty}</td><td className="mono small">{l.code ?? "—"}</td><td>{l.description}</td></tr>)}</tbody></table></div>}
        {included.length > 0 && <p className="small"><b>{t("Unidad funcional", "Functional unit")}:</b> {included.map((l) => `${l.qty} × ${l.component}${l.requiredForFunction ? "" : t(" (opcional)", " (optional)")}`).join(" · ")}</p>}
        {excluded.length > 0 && <p className="small"><b>{t("Excluido", "Excluded")}:</b> {excluded.map((l) => l.component).join(" · ")}</p>}
        {!po?.lines.length && included.length === 0 && <p className="small muted">{t("Sin líneas de alcance registradas.", "No scope lines recorded.")}</p>}
      </section>

      <section className="jblock">
        <div className="jbh"><b>{t("CON QUÉ SE CUMPLE", "HOW IT IS FULFILLED")}</b></div>
        <dl className="qv-dl">
          <dt>{t("Fuente principal", "Primary source")}</dt><dd>{basis?.primary ? <>{basis.primary.supplier?.name ?? "—"} · {basis.primary.label}{basis.primary.leadDaysMin != null ? ` · ${basis.primary.leadDaysMin}–${basis.primary.leadDaysMax ?? basis.primary.leadDaysMin} ${t("días", "days")}` : ""}{basis.primary.incoterm ? ` · ${basis.primary.incoterm}` : ""}</> : quote?.supplyPrimary ?? none}</dd>
          <dt>{t("Fuente alterna", "Backup source")}</dt><dd>{basis?.backup ? `${basis.backup.supplier?.name ?? "—"} · ${basis.backup.label}` : quote?.supplyAlt ?? none}</dd>
          <dt>{t("Pago previsto al proveedor", "Planned supplier payment")}</dt><dd>{basis?.paymentOption ? `${basis.paymentOption.method}${basis.paymentOption.daysToRelease != null ? ` · ${t("libera en", "releases in")} ${basis.paymentOption.daysToRelease} ${t("días", "days")}` : ""}${basis.paymentOption.note ? ` · ${basis.paymentOption.note}` : ""}` : none}</dd>
          <dt>{t("Datos logísticos", "Logistics data")}</dt><dd>{basis?.primary && (basis.primary.grossKg != null || basis.primary.dims) ? `${basis.primary.grossKg != null ? `${Number(basis.primary.grossKg)} kg` : ""}${basis.primary.dims ? ` · ${basis.primary.dims} cm` : ""}${basis.primary.packages ? ` · ${basis.primary.packages} ${t("bultos", "packages")}` : ""}${basis.primary.pickup ? ` · ${t("recoger en", "pickup at")} ${basis.primary.pickup}` : ""}` : none}</dd>
          <dt>{t("Importación", "Import")}</dt><dd>{basis?.primary?.importNote ?? basis?.primary?.importFeasibility ?? none}</dd>
          {basis?.risks && <><dt>{t("Riesgos de la fuente", "Source risks")}</dt><dd>{basis.risks}</dd></>}
          <dt>{t("Compras ya creadas", "Purchases already created")}</dt><dd>{d.supplierPos.length === 0 ? <Link href={`/compras?deal=${d.id}`}>{t("Ninguna: crear la compra", "None: create the purchase")}</Link> : d.supplierPos.map((p, k) => <span key={p.id}>{k > 0 && " · "}<Link href={`/compras/${p.id}`}>{p.code}</Link> {p.supplier.name}{p.releasedAt ? "" : t(" (sin liberar)", " (not released)")}</span>)}</dd>
        </dl>
      </section>

      <section className="jblock">
        <div className="jbh"><b>{t("ECONOMÍA PROTEGIDA Y CRÉDITO", "PROTECTED ECONOMICS AND CREDIT")}</b></div>
        <dl className="qv-dl">
          <dt>{t("Venta protegida", "Protected sale")}</dt><dd className="mono">{quote?.protSale != null ? money(quote.protSale) : "—"}</dd>
          <dt>{t("Costo protegido", "Protected cost")}</dt><dd className="mono">{quote?.protCost != null ? money(quote.protCost) : "—"}</dd>
          <dt>Eságara</dt><dd className="mono"><b>{quote?.protEsagra != null ? money(quote.protEsagra) : "—"}</b>{pct != null && ` · ${i.pct(pct)}`}</dd>
          <dt>{t("Condiciones", "Terms")}</dt><dd>{quote?.paymentTerms ?? "—"}{quote?.incoterm ? ` · ${quote.incoterm}` : ""}</dd>
          <dt>{t("Cupo del cliente", "Customer credit limit")}</dt><dd className="mono">{credit.limit != null ? money(credit.limit) : t("Sin cupo definido", "No limit set")}</dd>
          <dt>{t("Cartera abierta", "Open receivables")}</dt><dd className="mono">{money(credit.open)}{credit.overdue > 0 && <span className="risk-t"> · {t(`${money(credit.overdue)} vencida`, `${money(credit.overdue)} overdue`)}</span>}</dd>
        </dl>
      </section>

      <section className="jblock">
        <div className="jbh"><b>{t("RIESGOS ABIERTOS Y PRÓXIMO PASO", "OPEN RISKS AND NEXT STEP")}</b><span className="grow" /><Link className="small" href="/operaciones#excepcion">{t("Registrar excepción", "Record exception")}</Link></div>
        {d.opsExceptions.length === 0 ? <p className="small muted">{t("Sin excepciones abiertas.", "No open exceptions.")}</p> : <ul className="mk-ul">{d.opsExceptions.map((e) => <li key={e.id}><Link href={`/operaciones#x-${e.id}`}>{e.whatHappened}</Link> · <span className="muted">{i.day(e.deadline)}</span></li>)}</ul>}
        <p className="small"><b>{t("Próximo paso", "Next step")}:</b> {d.nextMove ?? t("No definido", "Not defined")}{d.nextMoveDate ? ` · ${i.day(d.nextMoveDate)}` : ""}{d.waitingFor ? ` · ${t("esperando", "waiting for")} ${d.waitingFor}${d.waitingUntil ? ` (${i.day(d.waitingUntil)})` : ""}` : ""}</p>
      </section>
    </div>
  );
}
