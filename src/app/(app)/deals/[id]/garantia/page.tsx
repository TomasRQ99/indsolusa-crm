import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEditOps } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { CLAIM_KINDS, CLAIM_STATES, RESPONSIBLE, coveredOn, warrantyState } from "@/lib/warranty-rules";
import { addClaimNote, addWarranty, closeClaim, openClaim, removeWarranty } from "./actions";

// Operaciones O9d · warranty and claims of one Journey (module 11 §45.1).

export default async function WarrantyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const d = await db.deal.findUnique({
    where: { id },
    select: {
      id: true, code: true, title: true, ownerId: true, account: { select: { id: true, name: true } },
      warranties: { orderBy: { startsOn: "asc" } },
      customerClaims: { orderBy: { createdAt: "desc" }, include: { warranty: true, notes: { orderBy: { createdAt: "asc" } } } },
      deliveries: { orderBy: { deliveredAt: "asc" }, select: { code: true, deliveredAt: true, lines: { select: { qty: true, serials: true, dealItem: { select: { code: true, description: true } } } } } },
    },
  });
  if (!d) notFound();
  const editable = canEditOps(user, d.ownerId);
  const T = today();
  // Delivered lines that have no warranty recorded yet: offered as a starting point, nothing is assumed.
  const delivered = d.deliveries.flatMap((x) => x.lines.map((l) => ({ item: `${l.qty} × ${l.dealItem.code ? `${l.dealItem.code} · ` : ""}${l.dealItem.description}`.slice(0, 200), serial: l.serials, at: x.deliveredAt, rem: x.code })));
  const pre = delivered.find((x) => !d.warranties.some((w) => w.item === x.item)) ?? null;
  const okMsg: Record<string, string> = { garantia: t("Garantía registrada.", "Warranty recorded."), quitada: t("Garantía quitada.", "Warranty removed."), caso: t("Caso abierto. También aparece en la atención de Operaciones.", "Case opened. It also shows in the Operations attention list."), nota: t("Nota agregada.", "Note added."), cerrado: t("Caso cerrado.", "Case closed."), "cerrado-final": t("Caso cerrado. La economía de este Journey ya estaba cerrada como final: el costo quedó en el caso y no cambió esa cifra.", "Case closed. This Journey's economics were already final: the cost stays on the case and didn't change that figure.") };
  const errMsg: Record<string, string> = { permiso: t("No tienes permiso sobre este Journey.", "You don't have permission on this Journey."), garantia: t("Indica el producto, desde cuándo y cuántos meses.", "Give the product, the start date and how many months."), "con-casos": t("Esa garantía tiene casos: no se quita.", "That warranty has cases: it can't be removed."), caso: t("Elige el tipo y escribe qué pasó.", "Choose the kind and write what happened."), nota: t("Escribe la nota.", "Write the note."), cerrado: t("Ese caso ya está cerrado.", "That case is already closed."), resolucion: t("Escribe qué se hizo.", "Write what was done."), responsable: t("Para resolverlo, indica quién fue responsable.", "To resolve it, say who was responsible.") };

  return (
    <div className="jw scp">
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href={`/deals/${d.id}?tab=execute`}>{d.code ?? d.title}</Link> · <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link></p>
          <span className="jid">{t("Garantía y reclamos", "Warranty and claims")}</span><span className="grow" />
        </div>
        <div className="jh-title"><h1>{t("¿Qué está cubierto y qué reclamó el cliente?", "What is covered and what did the customer claim?")}</h1></div>
        <p className="jh-sub">{t("La historia de la entrega no se cambia: cada caso se agrega encima, con sus notas.", "The delivery history is never changed: each case is added on top, with its notes.")}</p>
      </header>

      <section className="jblock" id="garantias">
        <div className="jbh"><b>{t("GARANTÍAS", "WARRANTIES")}</b></div>
        {d.warranties.length === 0 ? <p className="quiet-p">{t("Aún no hay garantías registradas en este Journey.", "No warranties recorded on this Journey yet.")}</p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Producto", "Product")}</th><th>{t("Serial", "Serial")}</th><th>{t("Cubre", "Covers")}</th><th>{t("Estado", "State")}</th><th>{t("Proveedor", "Supplier")}</th><th /></tr></thead>
            <tbody>{d.warranties.map((w) => { const s = warrantyState(w.startsOn, w.months, T); return (
              <tr key={w.id}>
                <td className="small"><b>{w.item}</b>{w.terms && <span className="src block">{w.terms}</span>}</td>
                <td className="mono small">{w.serial ?? "—"}</td>
                <td className="mono small">{i.day(w.startsOn)} – {i.day(s.end)}<span className="src block">{t(`${w.months} meses`, `${w.months} months`)}</span></td>
                <td>{s.active ? <span className={`sig ${s.daysLeft <= 60 ? "attn" : "ok"}`}>{t(`Vigente · ${s.daysLeft} días`, `Active · ${s.daysLeft} days`)}</span> : s.notStarted ? <span className="sig wait">{t("Aún no empieza", "Not started")}</span> : <span className="sig wait">{t("Vencida", "Expired")}</span>}</td>
                <td className="small">{w.supplierName ?? "—"}{w.supplierMonths ? <span className="src block">{t(`${w.supplierMonths} meses del proveedor`, `${w.supplierMonths} months from supplier`)}</span> : null}</td>
                <td>{editable && <form action={removeWarranty.bind(null, w.id)}><button type="submit" className="linkb">{t("quitar", "remove")}</button></form>}</td>
              </tr>
            ); })}</tbody>
          </table></div>
        )}
        {editable && (
          <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Registrar garantía", "+ Record warranty")}</summary>
            <form action={addWarranty.bind(null, d.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
              <label>{t("Producto", "Product")}<input name="item" required maxLength={200} defaultValue={pre?.item ?? ""} /></label>
              <div className="qa-row">
                <label>{t("Serial", "Serial")}<input name="serial" maxLength={200} defaultValue={pre?.serial ?? ""} /></label>
                <label style={{ flex: "0 0 160px" }}>{t("Empieza", "Starts")}<input name="startsOn" type="date" required defaultValue={dayInput(pre?.at ?? T)} /></label>
                <label style={{ flex: "0 0 120px" }}>{t("Meses", "Months")}<input name="months" type="number" min={1} max={240} required defaultValue={12} /></label>
              </div>
              <label>{t("Condiciones (qué cubre y qué no)", "Terms (what it covers and what it doesn't)")}<input name="terms" maxLength={300} /></label>
              <div className="qa-row">
                <label>{t("Proveedor que respalda", "Supplier behind it")}<input name="supplierName" maxLength={120} /></label>
                <label style={{ flex: "0 0 200px" }}>{t("Meses que da el proveedor", "Months the supplier gives")}<input name="supplierMonths" type="number" min={1} max={240} /></label>
              </div>
              {pre && <span className="src">{t(`Prellenado con lo entregado en ${pre.rem}. Los meses son un valor inicial: confirma lo que se le prometió al cliente.`, `Prefilled from what was delivered in ${pre.rem}. The months are a starting value: confirm what was promised to the customer.`)}</span>}
              <button type="submit">{t("Registrar garantía", "Record warranty")}</button>
            </form>
          </details>
        )}
      </section>

      <section className="jblock" id="casos">
        <div className="jbh"><b>{t("CASOS DEL CLIENTE", "CUSTOMER CASES")}</b></div>
        {d.customerClaims.length === 0 && <p className="quiet-p">{t("Sin casos.", "No cases.")}</p>}
        {d.customerClaims.map((c) => { const S = CLAIM_STATES[c.status] ?? CLAIM_STATES.OPEN; const cov = c.warranty ? coveredOn(c.warranty.startsOn, c.warranty.months, c.reportedAt) : null; return (
          <article key={c.id} className="exc-item" id={`c-${c.id}`}>
            <header className="exc-head"><span className={`sig ${S.tone}`}>{t(S.es, S.en)}</span> <b className="mono">{c.code}</b> <span className="small">{t(CLAIM_KINDS[c.kind]?.es ?? c.kind, CLAIM_KINDS[c.kind]?.en ?? c.kind)}</span><span className="grow" /><span className="small muted">{i.day(c.reportedAt)}{c.reportedBy ? ` · ${c.reportedBy}` : ""}</span></header>
            <p className="small">{c.whatHappened}</p>
            {c.warranty && <p className="small">{c.warranty.item}{c.warranty.serial ? ` · ${c.warranty.serial}` : ""} · {cov ? <span className="sig ok">{t("Dentro de la garantía el día del reporte", "Within warranty on the day reported")}</span> : <span className="sig attn">{t("Fuera del periodo de garantía el día del reporte", "Outside the warranty period on the day reported")}</span>}</p>}
            {c.notes.length > 0 && <ul className="plain small">{c.notes.map((n) => <li key={n.id}><span className="mono">{i.day(n.createdAt)}</span> · {n.text}<span className="muted"> · {n.byName}</span></li>)}</ul>}
            {c.status !== "OPEN" && <p className="small"><b>{t("Qué se hizo", "What was done")}:</b> {c.resolution} · {t("responsable", "responsible")}: {t(RESPONSIBLE[c.responsible]?.es ?? c.responsible, RESPONSIBLE[c.responsible]?.en ?? c.responsible)}{c.costUsd != null && <> · <span className="mono">USD {i.n2(Number(c.costUsd))}</span></>}<span className="muted"> · {c.resolvedByName} · {c.resolvedAt ? i.day(c.resolvedAt) : ""}</span></p>}
            {editable && c.status === "OPEN" && (
              <>
                <form action={addClaimNote.bind(null, c.id)} className="qa-row"><input name="text" required maxLength={500} placeholder={t("Qué pasó hoy con este caso", "What happened today on this case")} aria-label={t("Nota", "Note")} /><button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Agregar nota", "Add note")}</button></form>
                <details className="qa" style={{ marginTop: 6 }}><summary className="qa-btn">{t("Cerrar el caso", "Close the case")}</summary>
                  <form action={closeClaim.bind(null, c.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
                    <label>{t("Qué se hizo", "What was done")}<input name="resolution" required maxLength={500} /></label>
                    <div className="qa-row">
                      <label>{t("Quién fue responsable", "Who was responsible")}<select name="responsible" defaultValue={c.responsible}>{Object.entries(RESPONSIBLE).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                      <label style={{ flex: "0 0 200px" }}>{t("Lo que nos costó (USD)", "What it cost us (USD)")}<input name="costUsd" inputMode="decimal" /></label>
                    </div>
                    <div className="qa-row">
                      <button type="submit" name="status" value="RESOLVED" style={{ flex: "0 0 auto" }}>{t("Resuelto", "Resolved")}</button>
                      <button type="submit" name="status" value="REJECTED" className="secondary" style={{ flex: "0 0 auto" }}>{t("No procede", "Not accepted")}</button>
                    </div>
                    <span className="src">{t("El costo entra a los costos reales del Journey.", "The cost enters the Journey's real costs.")}</span>
                  </form>
                </details>
              </>
            )}
          </article>
        ); })}
        {editable && (
          <details className="qa" style={{ marginTop: 8 }}><summary className="qa-btn">{t("+ Abrir caso del cliente", "+ Open customer case")}</summary>
            <form action={openClaim.bind(null, d.id)} className="qa-form" style={{ marginTop: 8, maxWidth: 680 }}>
              <div className="qa-row">
                <label style={{ flex: "0 0 180px" }}>{t("Tipo", "Kind")}<select name="kind">{Object.entries(CLAIM_KINDS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                <label>{t("Sobre qué garantía (si aplica)", "About which warranty (if any)")}<select name="warrantyId" defaultValue=""><option value="">{t("Ninguna en particular", "None in particular")}</option>{d.warranties.map((w) => <option key={w.id} value={w.id}>{w.item}{w.serial ? ` · ${w.serial}` : ""}</option>)}</select></label>
              </div>
              <label>{t("Qué pasó, en palabras del cliente", "What happened, in the customer's words")}<textarea name="whatHappened" rows={2} required maxLength={500} /></label>
              <div className="qa-row">
                <label>{t("Quién lo reportó", "Who reported it")}<input name="reportedBy" maxLength={120} /></label>
                <label style={{ flex: "0 0 160px" }}>{t("Cuándo", "When")}<input name="reportedAt" type="date" defaultValue={dayInput(T)} /></label>
              </div>
              <button type="submit">{t("Abrir caso", "Open case")}</button>
            </form>
          </details>
        )}
      </section>
    </div>
  );
}
