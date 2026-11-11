import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isGerencia } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput, today } from "@/lib/domain";
import { strategicAccounts } from "@/lib/gerencia-views";
import { Notes } from "../ui";
import { chooseAccount, removeAccount, updateAccount } from "./actions";

// Módulo 15 §6 · Strategic accounts: Gerencia's view over the customers it chose. It does not replace the customer's
// record: every block opens it. What lives here is why the account matters and the next executive movement.

export default async function StrategicAccountsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireRole("GERENCIA", "DIRECTOR_COMERCIAL");
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ger = isGerencia(user);
  const T = today();
  const [rows, pick, people, ended] = await Promise.all([
    strategicAccounts(T),
    ger ? db.account.findMany({ where: { internal: false, OR: [{ strategic: null }, { strategic: { active: false } }] }, orderBy: { name: "asc" }, take: 500, select: { id: true, name: true } }) : [],
    ger ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    db.strategicAccount.findMany({ where: { active: false }, orderBy: { endedAt: "desc" }, take: 10, select: { id: true, endedAt: true, endedNote: true, endedByName: true, account: { select: { id: true, name: true } } } }),
  ]);
  const TREND = { WORSE: t("paga más lento que antes", "paying more slowly than before"), BETTER: t("paga más rápido que antes", "paying faster than before"), STABLE: t("paga como siempre", "paying as usual"), UNKNOWN: t("sin historia suficiente de pagos", "not enough payment history") };
  const ok = { elegida: t("Cuenta elegida como estratégica.", "Account chosen as strategic."), guardada: t("Guardado.", "Saved."), quitada: t("Ya no es cuenta estratégica. Su ficha de cliente no cambia.", "No longer a strategic account. Its customer record doesn't change.") };
  const err = { gerencia: t("Solo Gerencia elige las cuentas estratégicas.", "Only Management chooses strategic accounts."), permiso: t("Solo Gerencia o el directivo a cargo de la cuenta.", "Only Management or the executive in charge of the account."), datos: t("Elige el cliente y escribe por qué es estratégico.", "Choose the customer and write why it is strategic."), movimiento: t("Escribe el próximo movimiento y su fecha.", "Write the next movement and its date."), motivo: t("Escribe por qué deja de ser estratégica.", "Write why it stops being strategic."), "no-existe": t("No existe.", "It doesn't exist.") };

  return (
    <>
      <div className="ph"><div>
        <h1>{t("Cuentas estratégicas", "Strategic accounts")}</h1>
        <p>{t("Los clientes que Gerencia eligió seguir de cerca: por qué importan, quién los cubre, qué hay en curso, cómo pagan, qué riesgos tienen, dónde pueden crecer y cuál es el próximo movimiento directivo.", "The customers Management chose to follow closely: why they matter, who covers them, what is in progress, how they pay, what risks they carry, where they can grow and what the next executive movement is.")}</p>
      </div></div>
      <Notes sp={sp} ok={ok} err={err} />
      {rows.length === 0 && <div className="card"><p className="small muted">{ger ? t("Aún no hay cuentas elegidas. Elige la primera abajo.", "No accounts chosen yet. Choose the first one below.") : t("Gerencia aún no ha elegido cuentas estratégicas.", "Management hasn't chosen strategic accounts yet.")}</p></div>}

      {rows.map((a) => (
        <section key={a.id} id={`a-${a.id}`} className="card">
          <div><Link href={`/accounts/${a.accountId}`}><b style={{ fontSize: 15 }}>{a.name}</b></Link>{a.industry ? <span className="small muted"> · {a.industry}</span> : null} {a.attention ? <span className="sig attn">{t("pide atención", "asks for attention")}</span> : <span className="sig ok">{t("en orden", "in order")}</span>} <span className="small">· <Link href={`/accounts/${a.accountId}`}>{t("ficha completa del cliente", "full customer record")}</Link></span></div>
          <dl className="qv-dl" style={{ marginTop: 8 }}>
            <dt>{t("Por qué es estratégica", "Why it is strategic")}</dt><dd className="gm-pre">{a.reason}<span className="src block">{a.setBy} · {i.date(a.since)}</span></dd>
            <dt>{t("Quién la cubre", "Coverage")}</dt><dd>{t("Responsable", "Owner")}: <b>{a.coverage.owner}</b> · {t("respaldo", "backup")}: {a.coverage.backup ?? <b className="attn-t">{t("nadie", "nobody")}</b>} · {t("directivo", "executive")}: {a.coverage.executive ?? <b className="attn-t">{t("sin asignar", "not assigned")}</b>}<span className="src block">{t(`${a.coverage.contacts} contacto(s) registrados`, `${a.coverage.contacts} contact(s) recorded`)} · {a.coverage.lastContact ? t(`última actividad hace ${a.coverage.quietDays} día(s)`, `last activity ${a.coverage.quietDays} day(s) ago`) : t("sin actividad registrada", "no activity recorded")} · <Link href={`/mercado/empresas/${a.accountId}`}>{t("personas y relaciones", "people and relationships")}</Link></span></dd>
            <dt>{t("Necesidades y negocios", "Needs and deals")}</dt><dd>{t(`${a.work.needs} necesidad(es) sin cotizar · ${a.work.drafts} en preparación · ${a.work.presented} esperando decisión · ${a.work.accepted} en ejecución`, `${a.work.needs} Need(s) not quoted · ${a.work.drafts} being prepared · ${a.work.presented} awaiting decision · ${a.work.accepted} in execution`)}{a.work.openEsagara > 0 ? <span className="src block">{t("Eságara en juego (presentado y aceptado)", "Eságara in play (presented and accepted)")}: <b className="mono">{i.money(a.work.openEsagara)}</b></span> : null}</dd>
            <dt>{t("Eságara, 12 meses", "Eságara, 12 months")}</dt><dd>{a.year.n ? <><b className="mono">{i.money(a.year.esagara)}</b> {t("sobre", "on")} <span className="mono">{i.money(a.year.sale)}</span> {t("de venta", "of sales")} · {i.pct(a.year.pct)} · {t(`${a.year.n} cotización(es) aceptada(s)`, `${a.year.n} accepted quote(s)`)}</> : <span className="muted">{t("Nada aceptado en 12 meses", "Nothing accepted in 12 months")}</span>}</dd>
            <dt>{t("Cómo paga", "Cash behaviour")}</dt><dd>{t("Debe", "Owes")} <b className="mono">{i.money(a.cash.owes)}</b> · {t("cupo", "limit")} {a.cash.limit == null ? t("sin definir", "not set") : <span className="mono">{i.money(a.cash.limit)}</span>} · {TREND[a.cash.trend as keyof typeof TREND] ?? TREND.UNKNOWN} <span className="src">· <Link href={`/mercado/empresas/${a.accountId}#pagos`}>{t("ver el detalle", "see the detail")}</Link></span></dd>
            <dt>{t("Riesgos", "Risks")}</dt><dd>{a.risks.length ? <ul className="plain">{a.risks.map((r, k) => <li key={k}><span className="sig risk">{t("riesgo", "risk")}</span> {t(r.es, r.en)}</li>)}</ul> : <span className="sig ok">{t("Ninguno registrado", "None recorded")}</span>}</dd>
            <dt>{t("Dónde puede crecer", "Growth spaces")}</dt><dd>{a.growthNote ? <span className="gm-pre block">{a.growthNote}</span> : null}{a.growth.whiteSpaces.map((w) => <span key={w.id} className="src block">{t("Espacio en blanco", "White space")}: {w.what}</span>)}{a.growth.futures.map((f) => <span key={f.id} className="src block">{t("Oportunidad futura", "Future opportunity")}: {f.description}{f.expectedAt ? ` · ${i.date(f.expectedAt)}` : ""}</span>)}{!a.growthNote && a.growth.whiteSpaces.length + a.growth.futures.length === 0 ? <span className="muted">{t("Nada registrado todavía", "Nothing recorded yet")}</span> : null}</dd>
            <dt>{t("Próximo movimiento directivo", "Next executive movement")}</dt><dd>{a.nextMove ? <><b>{a.nextMove}</b> · {a.nextMoveOn ? i.date(a.nextMoveOn) : t("sin fecha", "no date")}{a.moveLate ? <b className="risk-t"> · {t("ya pasó su fecha", "past its date")}</b> : null}</> : <b className="attn-t">{t("Sin definir", "Not defined")}</b>}</dd>
          </dl>
          {(ger || a.coverage.executiveId === user.id) && (
            <details open={a.moveLate || !a.nextMove}><summary className="small">{ger ? t("Actualizar", "Update") : t("Actualizar el próximo movimiento", "Update the next movement")}</summary>
              <form action={updateAccount.bind(null, a.id)} className="qa-form">
                <div className="qa-row">
                  <label style={{ flex: "3 1 300px" }}>{t("Próximo movimiento directivo", "Next executive movement")}<input name="nextMove" required maxLength={500} defaultValue={a.nextMove ?? ""} /></label>
                  <label style={{ flex: "1 1 160px" }}>{t("Fecha", "Date")}<input type="date" name="nextMoveOn" required defaultValue={a.nextMoveOn ? dayInput(a.nextMoveOn) : ""} /></label>
                </div>
                {ger && <>
                  <label>{t("Por qué es estratégica", "Why it is strategic")}<textarea name="reason" required rows={2} maxLength={1000} defaultValue={a.reason} /></label>
                  <div className="qa-row">
                    <label style={{ flex: "3 1 300px" }}>{t("Dónde puede crecer (opcional)", "Where it can grow (optional)")}<input name="growthNote" maxLength={1000} defaultValue={a.growthNote ?? ""} /></label>
                    <label style={{ flex: "1 1 200px" }}>{t("Directivo a cargo", "Executive in charge")}<select name="executiveId" defaultValue={a.coverage.executiveId ?? ""}><option value="">{t("Sin asignar", "Not assigned")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  </div>
                </>}
                <div><button type="submit" className="secondary">{t("Guardar", "Save")}</button></div>
              </form>
              {ger && <form action={removeAccount.bind(null, a.id)} className="qa-row" style={{ alignItems: "center", marginTop: 8 }}><input name="note" required maxLength={500} placeholder={t("Por qué deja de ser estratégica", "Why it stops being strategic")} aria-label={t("Por qué deja de ser estratégica", "Why it stops being strategic")} /><button type="submit" className="secondary sm" style={{ flex: "0 0 auto" }}>{t("Quitar de las estratégicas", "Remove from strategic")}</button></form>}
            </details>
          )}
        </section>
      ))}

      {ended.length > 0 && <details className="card"><summary className="small">{t(`Dejaron de ser estratégicas (${ended.length})`, `No longer strategic (${ended.length})`)}</summary><ul className="plain small">{ended.map((e) => <li key={e.id}><Link href={`/accounts/${e.account.id}`}>{e.account.name}</Link> · {i.date(e.endedAt)} · {e.endedByName}: {e.endedNote}</li>)}</ul></details>}

      {ger && (
        <section className="card" id="elegir"><b>{t("ELEGIR UNA CUENTA ESTRATÉGICA", "CHOOSE A STRATEGIC ACCOUNT")}</b>
          <form action={chooseAccount} className="qa-form">
            <div className="qa-row">
              <label style={{ flex: "2 1 260px" }}>{t("Cliente", "Customer")}<select name="accountId" required defaultValue=""><option value="" disabled>{t("Elegir", "Choose")}</option>{pick.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label style={{ flex: "1 1 200px" }}>{t("Directivo a cargo", "Executive in charge")}<select name="executiveId" defaultValue={user.id}><option value="">{t("Sin asignar", "Not assigned")}</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </div>
            <label>{t("Por qué es estratégica", "Why it is strategic")}<textarea name="reason" required rows={2} maxLength={1000} /></label>
            <label>{t("Dónde puede crecer (opcional)", "Where it can grow (optional)")}<input name="growthNote" maxLength={1000} /></label>
            <div className="qa-row">
              <label style={{ flex: "3 1 300px" }}>{t("Próximo movimiento directivo (opcional)", "Next executive movement (optional)")}<input name="nextMove" maxLength={500} /></label>
              <label style={{ flex: "1 1 160px" }}>{t("Fecha", "Date")}<input type="date" name="nextMoveOn" /></label>
            </div>
            <div><button type="submit">{t("Elegir como estratégica", "Choose as strategic")}</button></div>
          </form>
        </section>
      )}
    </>
  );
}
