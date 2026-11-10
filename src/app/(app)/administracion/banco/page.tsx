import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canFinance } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/domain";
import { sumMoney } from "@/lib/money";
import { CLASSES, matchState, suggest } from "@/lib/bank-csv";
import { classifyTx, createPaymentFromTx, matchCustomerPayment, matchExecution, removeMatch, saveBankAccount, undoStatement, uploadStatement } from "./actions";

// Operaciones O9a · bank statements (module 11 §42): what the bank says happened, next to what SOLU knows.
// Suggested, confirmed, partial and unmatched are different states; SOLU never confirms a match by itself.

export default async function BankPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; st?: string; vi?: string; ver?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const edit = canFinance(user);
  const all = sp.ver === "todo";
  const since = addDays(today(), -120);
  const [accounts, statements, txs, payments, executions, customers] = await Promise.all([
    db.bankAccount.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    db.bankStatement.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { bankAccount: { select: { label: true } }, _count: { select: { transactions: true } } } }),
    db.bankTransaction.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 400, include: { bankAccount: { select: { label: true, currency: true } }, matches: { include: { customerPayment: { select: { id: true, reference: true, account: { select: { name: true } } } }, paymentExecution: { select: { id: true, paymentId: true, payment: { select: { supplierPo: { select: { code: true, supplier: { select: { name: true } } } } } } } } } } } }),
    db.customerPayment.findMany({ where: { kind: "CASH", receivedAt: { gte: since } }, select: { id: true, amount: true, receivedAt: true, reference: true, account: { select: { name: true } }, bankMatches: { select: { amount: true } } } }),
    db.paymentExecution.findMany({ where: { sentAt: { gte: since }, state: { not: "FAILED" } }, select: { id: true, amount: true, sentAt: true, bankRef: true, payment: { select: { supplierPo: { select: { code: true, supplier: { select: { name: true } } } } } }, bankMatches: { select: { amount: true } } } }),
    edit ? db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const payC = payments.map((p) => ({ id: p.id, amount: Number(p.amount), date: p.receivedAt, label: `${p.account.name}${p.reference ? ` · ${p.reference}` : ""}`, alreadyMatched: sumMoney(p.bankMatches.map((m) => m.amount)) }));
  const exeC = executions.map((e) => ({ id: e.id, amount: Number(e.amount), date: e.sentAt, label: `${e.payment.supplierPo.supplier.name} · ${e.payment.supplierPo.code}${e.bankRef ? ` · ${e.bankRef}` : ""}`, alreadyMatched: sumMoney(e.bankMatches.map((m) => m.amount)) }));
  const rows = txs.map((x) => ({ x, s: matchState(Number(x.amount), sumMoney(x.matches.map((m) => m.amount)), x.classifiedAs) }));
  const open = rows.filter((r) => r.s.state === "UNMATCHED" || r.s.state === "PARTIAL");
  const shown = all ? rows : open;
  const last = sp.st ? statements.find((s) => s.id === sp.st) : null;
  const tone = { UNMATCHED: "attn", PARTIAL: "attn", MATCHED: "ok", CLASSIFIED: "wait" } as const;
  const word = { UNMATCHED: t("Sin explicar", "Unmatched"), PARTIAL: t("Explicado en parte", "Partially matched"), MATCHED: t("Explicado", "Matched"), CLASSIFIED: t("Apartado", "Set aside") };
  const okMsg: Record<string, string> = { cuenta: t("Cuenta guardada.", "Account saved."), deshecho: t("Carga deshecha.", "Upload undone."), cruzado: t("Movimiento cruzado.", "Movement matched."), "pago-creado": t("Pago del cliente registrado desde el banco. Falta aplicarlo a sus facturas en Pagos recibidos.", "Customer payment recorded from the bank. It still has to be applied to its invoices in Payments received."), clasificado: t("Movimiento actualizado.", "Movement updated."), descruzado: t("Cruce quitado.", "Match removed.") };
  const errMsg: Record<string, string> = {
    permiso: t("Esto corresponde a Finanzas, Administración o Gerencia.", "This is for Finance, Administration or Management."), cuenta: t("Indica el nombre de la cuenta.", "Give the account a name."),
    archivo: t("Elige el archivo del banco en formato CSV (hasta 2 MB).", "Choose the bank's file in CSV format (up to 2 MB)."), vacio: t("El archivo está vacío.", "The file is empty."),
    columnas: t("SOLU no reconoció las columnas de fecha, descripción y valor, así que no cargó nada. Títulos que vio: ", "SOLU didn't recognise the date, description and amount columns, so it loaded nothing. Titles it saw: ") + (sp.vi ?? "—"),
    "sin-movimientos": t("El archivo no trae movimientos.", "The file has no movements."), deshacer: t("Ya se trabajó sobre movimientos de esa carga: no se puede deshacer.", "Movements from that upload were already worked on: it can't be undone."),
    cruce: t("Ese cruce no aplica: revisa el sentido del movimiento y lo que queda por explicar.", "That match doesn't apply: check the direction of the movement and what is left to explain."), clasificar: t("Elige qué es y escribe una nota. Un movimiento ya cruzado no se aparta.", "Choose what it is and write a note. A movement already matched can't be set aside."), movimiento: t("Ese movimiento no existe.", "That movement doesn't exist."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <h1>{t("Banco", "Bank")}</h1>
          <p>{t("Sube el extracto cada vez que llegue uno nuevo. SOLU muestra cada movimiento junto a lo que ya sabe y sugiere a qué corresponde; una persona confirma. Subir dos veces el mismo periodo no duplica nada.", "Upload the statement every time a new one arrives. SOLU shows each movement next to what it already knows and suggests what it is; a person confirms. Uploading the same period twice duplicates nothing.")}</p>
        </div>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.ok === "cargado" && last && <div className="note okn">{t(`${last.fileName}: ${last.added} movimientos nuevos, ${last.duplicates} ya estaban cargados${last.skipped ? `, ${last.skipped} filas no se pudieron leer` : ""}.`, `${last.fileName}: ${last.added} new movements, ${last.duplicates} were already loaded${last.skipped ? `, ${last.skipped} rows could not be read` : ""}.`)}</div>}
      {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <section className="card" id="cargar">
        <b>{t("SUBIR EXTRACTO", "UPLOAD STATEMENT")}</b>
        {accounts.length === 0 ? <p className="small muted">{t("Primero registra la cuenta bancaria (solo un nombre y los últimos 4 dígitos).", "Register the bank account first (just a name and the last 4 digits).")}</p> : edit && (
          <form action={uploadStatement} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ flex: "0 0 260px" }}>{t("Cuenta", "Account")}<select name="bankAccountId">{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}{a.last4 ? ` ····${a.last4}` : ""}</option>)}</select></label>
            <label>{t("Archivo del banco (CSV)", "Bank file (CSV)")}<input name="file" type="file" accept=".csv,.txt,text/csv" required /></label>
            <button type="submit" style={{ flex: "0 0 auto" }}>{t("Subir y leer", "Upload and read")}</button>
          </form>
        )}
        <p className="src">{t("Descarga los movimientos de la cuenta desde la banca en línea en formato CSV (texto separado por comas). El archivo no se guarda en SOLU; solo los movimientos leídos.", "Download the account's movements from online banking in CSV format (comma-separated text). The file is not stored in SOLU; only the movements read from it.")}</p>
        {edit && (
          <details className="qa"><summary className="qa-btn">{t("+ Registrar cuenta bancaria", "+ Register bank account")}</summary>
            <form action={saveBankAccount} className="qa-row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
              <label>{t("Nombre para reconocerla", "Name to recognise it")}<input name="label" required maxLength={80} placeholder="Bank of America · Operativa" /></label>
              <label style={{ flex: "0 0 150px" }}>{t("Últimos 4 dígitos", "Last 4 digits")}<input name="last4" maxLength={4} inputMode="numeric" /></label>
              <label style={{ flex: "0 0 100px" }}>{t("Moneda", "Currency")}<input name="currency" maxLength={3} defaultValue="USD" /></label>
              <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Guardar cuenta", "Save account")}</button>
            </form>
          </details>
        )}
        {statements.length > 0 && (
          <div className="tscroll" style={{ marginTop: 10 }}><table>
            <thead><tr><th>{t("Extracto", "Statement")}</th><th>{t("Periodo", "Period")}</th><th className="n">{t("Nuevos", "New")}</th><th className="n">{t("Repetidos", "Already loaded")}</th><th /></tr></thead>
            <tbody>{statements.map((s) => (
              <tr key={s.id}>
                <td className="small"><b>{s.fileName}</b><span className="src block">{s.bankAccount.label} · {s.uploadedByName} · {i.day(s.createdAt)}</span></td>
                <td className="mono small">{s.periodFrom ? i.day(s.periodFrom) : "—"} – {s.periodTo ? i.day(s.periodTo) : "—"}</td>
                <td className="n mono">{s.added}</td><td className="n mono">{s.duplicates}</td>
                <td>{edit && s._count.transactions > 0 && <form action={undoStatement.bind(null, s.id)}><button type="submit" className="linkb">{t("deshacer carga", "undo upload")}</button></form>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card" id="movimientos">
        <b>{all ? t("TODOS LOS MOVIMIENTOS", "ALL MOVEMENTS") : t("MOVIMIENTOS POR EXPLICAR", "MOVEMENTS TO EXPLAIN")} · {shown.length}</b>
        <p className="small">{all ? <Link href="/administracion/banco#movimientos">{t("Ver solo los que faltan por explicar", "Show only those still to explain")}</Link> : <Link href="/administracion/banco?ver=todo#movimientos">{t(`Ver todos (${rows.length})`, `Show all (${rows.length})`)}</Link>}</p>
        {shown.length === 0 && <p className="small muted">{rows.length ? t("Todo lo cargado está explicado.", "Everything loaded is explained.") : t("Aún no hay movimientos. Sube el primer extracto.", "No movements yet. Upload the first statement.")}</p>}
        {shown.map(({ x, s }) => {
          const amt = Number(x.amount), cur = x.bankAccount.currency;
          const isOpen = s.state === "UNMATCHED" || s.state === "PARTIAL";
          const sug = isOpen ? (amt > 0 ? suggest(amt, x.date, s.open, payC) : suggest(amt, x.date, s.open, exeC)) : [];
          return (
            <article key={x.id} className="exc-item">
              <header className="exc-head"><span className={`sig ${tone[s.state]}`}>{word[s.state]}</span> <b className={`mono${amt < 0 ? " risk-t" : ""}`}>{amt > 0 ? "+" : "−"} {cur} {i.n2(Math.abs(amt))}</b><span className="grow" /><span className="small muted">{i.day(x.date)} · {x.bankAccount.label}</span></header>
              <p className="small">{x.description}{x.reference && <span className="muted"> · {x.reference}</span>}{s.state === "PARTIAL" && <b> · {t(`faltan ${cur} ${i.n2(s.open)}`, `${cur} ${i.n2(s.open)} left`)}</b>}</p>
              {x.matches.map((m) => (
                <div key={m.id} className="small">✓ {cur} {i.n2(Number(m.amount))} → {m.customerPayment ? <><Link href="/administracion/pagos-recibidos">{t("pago de", "payment from")} {m.customerPayment.account.name}</Link></> : m.paymentExecution ? <Link href={`/administracion/pagos-proveedores/${m.paymentExecution.paymentId}`}>{t("pago a", "payment to")} {m.paymentExecution.payment.supplierPo.supplier.name} · {m.paymentExecution.payment.supplierPo.code}</Link> : "—"}<span className="muted"> · {m.createdByName}</span>{edit && <form action={removeMatch.bind(null, m.id)} className="inline-f"><button type="submit" className="linkb">{t("quitar", "remove")}</button></form>}</div>
              ))}
              {x.classifiedAs && <div className="small">{t(CLASSES[x.classifiedAs]?.es ?? x.classifiedAs, CLASSES[x.classifiedAs]?.en ?? x.classifiedAs)}: {x.classNote}<span className="muted"> · {x.classByName}</span>{edit && <form action={classifyTx.bind(null, x.id)} className="inline-f"><input type="hidden" name="clear" value="1" /><button type="submit" className="linkb">{t("deshacer", "undo")}</button></form>}</div>}
              {edit && isOpen && (
                <>
                  {sug.length > 0 && <div className="note" style={{ marginTop: 6 }}><span className="k">{t("SOLU sugiere (mismo valor, fecha cercana)", "SOLU suggests (same amount, close date)")}</span>
                    {sug.slice(0, 3).map((c) => (
                      <form key={c.id} action={amt > 0 ? matchCustomerPayment.bind(null, x.id) : matchExecution.bind(null, x.id)} className="qa-row" style={{ alignItems: "center" }}>
                        <input type="hidden" name={amt > 0 ? "paymentId" : "executionId"} value={c.id} />
                        <span className="small" style={{ flex: "1 1 240px" }}>{c.label} · <span className="mono">{cur} {i.n2(c.amount)}</span> · {i.day(c.date)}</span>
                        <button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Sí, es este", "Yes, this one")}</button>
                      </form>
                    ))}
                  </div>}
                  <details className="qa" style={{ marginTop: 6 }}><summary className="qa-btn">{t("Decir qué es", "Say what it is")}</summary>
                    <div style={{ marginTop: 8, display: "grid", gap: 10, maxWidth: 680 }}>
                      {amt > 0 && (
                        <form action={createPaymentFromTx.bind(null, x.id)} className="qa-row" style={{ alignItems: "flex-end" }}>
                          <label>{t("Es un pago de este cliente", "It is a payment from this customer")}<select name="accountId" required defaultValue=""><option value="" disabled>{t("Elegir cliente…", "Choose customer…")}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                          <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Registrar pago recibido", "Record payment received")}</button>
                        </form>
                      )}
                      {x.matches.length === 0 && (
                        <form action={classifyTx.bind(null, x.id)} className="qa-row" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
                          <label style={{ flex: "0 0 280px" }}>{t("No es de cliente ni proveedor", "Not customer or supplier")}<select name="as">{Object.entries(CLASSES).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                          <label>{t("Nota", "Note")}<input name="note" required maxLength={300} /></label>
                          <button type="submit" className="secondary" style={{ flex: "0 0 auto" }}>{t("Apartar", "Set aside")}</button>
                        </form>
                      )}
                    </div>
                  </details>
                </>
              )}
            </article>
          );
        })}
        {rows.length >= 400 && <p className="src">{t("Se muestran los 400 movimientos más recientes.", "Showing the 400 most recent movements.")}</p>}
      </section>
    </>
  );
}
