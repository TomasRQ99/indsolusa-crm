import Link from "next/link";
import { ValueKindSelect } from "@/components/ValueKindSelect";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canEditMoney, canManageAll } from "@/lib/permissions";
import { Withholdings } from "@/components/Withholdings";
import { savePaymentMap } from "../../comercial/dinero/actions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { stageLabel } from "@/lib/labels";
import { basisOf, stateLabel } from "@/lib/result";
import { billingPattern, customerInclude, freshness, installedContext, type Fresh } from "@/lib/x360";
import { addAccountDocuments, deleteAccount, deleteAccountDocument, updateAccount, updateBilling } from "../actions";
import { createContact } from "../../contacts/actions";
import { logActivity } from "../../activities/actions";
import { createNeedFromContext } from "../../productos/actions";
import { mailConfig } from "@/lib/mail";
import { getPayRules } from "@/lib/pay-behavior";
import { EmailComposer } from "@/components/EmailComposer";
import { Popovers } from "@/components/Popovers";

export default async function Customer360({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const a = await db.account.findUnique({ where: { id }, include: customerInclude });
  if (!a) notFound();
  const now = today();
  const editable = canEdit(user, a.ownerId);
  const mail = mailConfig();
  const recipients = a.contacts.filter((c) => c.email).map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName} <${c.email}>` }));
  const MAP_ROLES = [["RECEIVES", t("Recibe la factura", "Receives the invoice")], ["VALIDATES", t("Valida", "Validates")], ["APPROVES", t("Aprueba", "Approves")], ["SCHEDULES", t("Programa el pago", "Schedules payment")], ["PAYS", t("Paga (Tesorería)", "Pays (Treasury)")]] as const;
  const [users, docs, payRules, payMap] = await Promise.all([
    canManageAll(user) ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    // The file bytes stay in the database: only the list is loaded here.
    db.accountDocument.findMany({ where: { accountId: id }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, name: true, size: true, extracted: true, createdAt: true } }),
    getPayRules(),
    db.paymentMap.findUnique({ where: { accountId: id }, include: { people: { include: { contact: { select: { id: true, firstName: true, lastName: true, title: true } } } } } }),
  ]);
  const mapEditable = canEditMoney(user, a.ownerId);
  const F = ({ f, src }: { f: Fresh; src?: string | null }) => <span className={`fresh${f.stale ? " stale" : ""}`}>{src ? `${src} · ` : ""}{f.label}{f.stale && f.at ? ` · ${t("confirmar", "re-confirm")}` : ""}</span>;

  // Past results: Journeys whose result is known (never "delivered = achieved").
  const past = a.deals.filter((d) => d.resultState !== "PENDING" || d.closedAt);
  const count = (s: string) => past.filter((d) => d.resultState === s).length;
  const recoveredN = past.filter((d) => d.recoveries.some((r) => r.outcome === "RECOVERED")).length;
  // Active Journeys
  const active = a.deals.filter((d) => d.stage !== "LOST" && !d.closedAt && d.resultState !== "NO_LONGER_RELEVANT" && d.resultState !== "ACHIEVED");
  // Future signals (legitimate reasons to come back)
  const signals = a.deals.flatMap((d) => d.continuity.filter((c) => !c.resolvedAt).map((c) => ({ c, d }))).sort((x, y) => +(x.c.triggerOn ?? x.c.createdAt) - +(y.c.triggerOn ?? y.c.createdAt));
  const nextSignal = signals.find((s) => s.c.triggerOn && s.c.triggerOn >= now) ?? signals[0] ?? null;
  // Billing pattern & installed context
  const bp = billingPattern(a, now, payRules.value);
  const ex = bp.behavior.expected;
  const onTime = bp.behavior.windows[3].onTimePct;
  const installed = installedContext(a);
  // Relationships: business role + last real interaction per contact.
  const lastTouch = (contactId: string) => {
    const xs = [...a.activities.filter((x) => x.contactId === contactId).map((x) => x.occurredAt), ...a.threads.filter((x) => x.contactId === contactId).map((x) => x.lastAt)];
    return xs.sort((p, q) => +q - +p)[0] ?? null;
  };
  const lastInteraction = [a.activities[0]?.occurredAt, a.threads[0]?.lastAt].filter(Boolean).sort((p, q) => +q! - +p!)[0] ?? null;
  const isNew = a.deals.filter((d) => d.stage === "WON").length <= 1 && bp.invoices <= 1 && daysSince(a.createdAt, now) < 120;
  const unknowns = [
    !bp.hist.n && t("cómo paga en la práctica (aún sin facturas cobradas)", "how they actually pay (no collected invoices yet)"),
    !past.length && t("si nuestras soluciones le dieron resultado", "whether our solutions gave them results"),
    !installed.length && t("qué equipos tiene instalados", "what equipment they have installed"),
    !a.taxDataComplete && t("datos tributarios para facturar", "tax data to invoice"),
    a.contacts.length < 2 && t("más de un contacto (quién decide, quién paga)", "more than one contact (who decides, who pays)"),
  ].filter(Boolean) as string[];

  return (
    <div className="jw x3">
      <header className="jh">
        <div className="jh-top">
          <p className="crumb k"><Link href="/accounts">{t("Clientes", "Customers")}</Link></p>
          <span className="jid">Customer 360</span>
          <span className="grow" />
          <F f={freshness(i, lastInteraction, 90, now)} src={t("última interacción", "last interaction")} />
        </div>
        <div className="jh-title"><h1>{a.name}</h1></div>
        <p className="jh-sub">{a.industry ?? t("Sin industria", "No industry")} · {t("Responsable", "Owner")}: {a.owner.name} · {t(`cliente desde ${i.day(a.createdAt)}`, `customer since ${i.day(a.createdAt)}`)} · <Link href={`/mercado/empresas/${a.id}`}>{t("Cómo funciona esta empresa (Mercado)", "How this company works (Market)")}</Link> · <Link href={`/comercial/perfiles/${a.id}`}>{t("Perfil y diario", "Profile and diary")}</Link></p>
      </header>

      {isNew && (
        <div className="note">
          <b>{t("Cliente nuevo: poco conocimiento todavía.", "New customer: little knowledge yet.")}</b> {t("Lo que aún no sabemos", "What we don't know yet")}: {unknowns.join(" · ") || "—"}.
        </div>
      )}

      <section className="x3-facts">
        <div className="x3-f">
          <span className="k">{t("RESULTADOS PASADOS", "PAST RESULTS")}</span>
          <b>{past.length ? t(`${count("ACHIEVED")} logrado(s) de ${past.length}`, `${count("ACHIEVED")} achieved of ${past.length}`) : t("Sin resultados confirmados", "No confirmed results")}</b>
          <span className="src">{[recoveredN ? t(`${recoveredN} tras Recovery`, `${recoveredN} after recovery`) : null, count("PARTIAL") ? t(`${count("PARTIAL")} parcial`, `${count("PARTIAL")} partial`) : null, count("NOT_ACHIEVED") ? t(`${count("NOT_ACHIEVED")} no logrado`, `${count("NOT_ACHIEVED")} not achieved`) : null].filter(Boolean).join(" · ") || t("entregar no cuenta como resultado", "delivering doesn't count as a result")}</span>
        </div>
        <div className={`x3-f${active.some((d) => d.recoveries.some((r) => !r.resolvedAt)) ? " risk" : ""}`}>
          <span className="k">{t("NECESIDADES ACTIVAS", "ACTIVE NECESSITIES")}</span>
          <b>{active.length || t("Ninguno", "None")}</b>
          <span className="src">{active.filter((d) => d.recoveries.some((r) => !r.resolvedAt)).length ? t(`${active.filter((d) => d.recoveries.some((r) => !r.resolvedAt)).length} con Recovery abierta`, `${active.filter((d) => d.recoveries.some((r) => !r.resolvedAt)).length} with an open recovery`) : t("sin Recovery abierta", "no open recovery")}</span>
        </div>
        <div className="x3-f">
          <span className="k">{t("CÓMO PAGA", "HOW THEY PAY")}</span>
          <b>{ex.expectedDays != null ? t(`Paga en ~${ex.expectedDays} d (plazo ${a.paymentTermsDays})`, `Pays in ~${ex.expectedDays} d (${a.paymentTermsDays}-day terms)`) : t("Sin historial", "No history")}</b>
          <span className="src">{ex.expectedDays == null ? t(`plazo ${a.paymentTermsDays} d`, `${a.paymentTermsDays}-day terms`) : t(`${ex.n} factura(s) cobrada(s)${ex.enough ? "" : " · orientativo"}`, `${ex.n} invoice(s) collected${ex.enough ? "" : " · indicative"}`)}{onTime != null ? t(` · a tiempo ${i.n(onTime)} %`, ` · on time ${i.n(onTime)} %`) : ""}{bp.kept + bp.broken ? t(` · promesas cumplidas ${bp.kept}/${bp.kept + bp.broken}`, ` · promises kept ${bp.kept}/${bp.kept + bp.broken}`) : ""} · <Link href={`/mercado/empresas/${a.id}#pagos`}>{t("detalle", "detail")}</Link></span>
          <F f={freshness(i, bp.lastPaid, 180, now)} src={t("último pago", "last payment")} />
        </div>
        <div className={`x3-f${nextSignal?.c.triggerOn && nextSignal.c.triggerOn < now ? " stale" : ""}`}>
          <span className="k">{t("SEÑAL FUTURA", "FUTURE SIGNAL")}</span>
          <b>{nextSignal ? nextSignal.c.what : t("Ninguna legítima", "None legitimate")}</b>
          <span className="src">{nextSignal ? `${nextSignal.c.triggerOn ? (nextSignal.c.triggerOn < now ? t(`venció ${i.day(nextSignal.c.triggerOn)} · revisar`, `passed ${i.day(nextSignal.c.triggerOn)} · review`) : i.day(nextSignal.c.triggerOn)) : nextSignal.c.triggerEvent ?? ""} · ${nextSignal.c.basis}` : t("solo con una razón real del cliente", "only with a real customer reason")}</span>
        </div>
      </section>

      <div className="jbody">
        <div className="jmain">
          <section className="jblock">
            <div className="jbh"><b>{t("NECESIDADES ACTIVAS", "ACTIVE NECESSITIES")}</b><span className="grow" /><span className="src">{t("entra a la Necesidad para actuar", "enter the Necessity to act")}</span></div>
            {active.length === 0 ? <p className="quiet-p">{t("Nada en curso.", "Nothing in progress.")}</p> : (
              <ul className="x3-j">{active.map((d) => {
                const rec = d.recoveries.find((r) => !r.resolvedAt);
                const L = stateLabel(i, d.resultState);
                return (
                  <li key={d.id}>
                    <Link href={`/deals/${d.id}`} className="x3-jl"><span className="mono">{d.code}</span> <b>{d.title}</b></Link>
                    <span className="src">{stageLabel(i, d.stage)}{d.stage === "WON" && d.resultState !== "PENDING" ? ` · ${L.text}` : ""} · {d.owner.name}</span>
                    {rec ? <span className="small risk-t">Recovery: {rec.whatChanged}</span>
                      : d.waitingFor ? <span className="small">{t("Esperando", "Waiting for")}: {d.waitingFor}{d.waitingUntil ? ` · ${i.day(d.waitingUntil)}` : ""}</span>
                      : d.nextMove ? <span className="small">{t("Siguiente", "Next")}: {d.nextMove}{d.nextMoveDate ? ` · ${i.day(d.nextMoveDate)}` : ""}</span> : null}
                  </li>
                );
              })}</ul>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("RESULTADOS PASADOS", "PAST RESULTS")}</b><span className="grow" /><span className="src">{t("deseado → real, con la evidencia del cliente", "desired → actual, with the customer's evidence")}</span></div>
            {past.length === 0 ? <p className="quiet-p">{t("Aún no hay resultados confirmados con este cliente.", "No confirmed results with this customer yet.")}</p> : (
              <ul className="x3-r">{past.map((d) => {
                const L = stateLabel(i, d.resultState, d.recoveries.some((r) => r.outcome === "RECOVERED"));
                const ev = basisOf(d);
                return (
                  <li key={d.id}>
                    <div className="x3-rh"><Link href={`/deals/${d.id}/resultado`} className="mono small">{d.code}</Link><span className={`sig ${L.cls}`}>{L.text}</span>{d.closedAt && <span className="src">{t("cerrado", "closed")} {i.day(d.closedAt)}</span>}</div>
                    <p className="small"><span className="muted">{d.desiredResult ?? d.title}</span> → <b>{d.actualResult ?? "—"}</b></p>
                    {ev && <p className="src">«{ev.text}» — {ev.who ?? "—"} · <F f={freshness(i, ev.at, 365, now)} /></p>}
                    {d.closureLearning && <p className="src">{t("Aprendimos", "Learned")}: {d.closureLearning}</p>}
                  </li>
                );
              })}</ul>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("CONTEXTO INSTALADO", "INSTALLED CONTEXT")}</b><span className="grow" /><span className="src">{t("lo que entregamos y si sigue dando resultado", "what we delivered and whether it still works")}</span></div>
            {installed.length === 0 ? <p className="quiet-p">{t("No le hemos entregado equipos todavía.", "We haven't delivered equipment yet.")}</p> : (
              <table className="x3-t">
                <thead><tr><th>{t("Equipo", "Equipment")}</th><th className="n">{t("Cant.", "Qty")}</th><th>{t("Entregado", "Delivered")}</th><th>{t("Resultado", "Result")}</th></tr></thead>
                <tbody>{installed.map((x, n) => {
                  const L = stateLabel(i, x.state as Parameters<typeof stateLabel>[1]);
                  return (
                    <tr key={n}>
                      <td>{x.code ? <Link href={`/productos/${encodeURIComponent(x.code)}`} className="val">{x.code}</Link> : null} <span className="small">{x.description}</span></td>
                      <td className="n mono">{x.qty}</td>
                      <td><span className="mono">{i.day(x.at)}</span> <F f={freshness(i, x.at, 365, now)} /></td>
                      <td><Link href={`/deals/${x.dealId}/resultado`} className={`sig ${L.cls}`}>{L.text}</Link></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            {installed.some((x) => freshness(i, x.at, 365, now).stale) && <p className="src" style={{ marginTop: 6 }}>{t("Lo instalado hace más de un año puede haber cambiado: confírmalo antes de usarlo para cotizar.", "What was installed over a year ago may have changed: confirm it before using it to quote.")}</p>}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("SEÑALES FUTURAS", "FUTURE SIGNALS")}</b><span className="grow" /><span className="src">{t("no son oportunidades: razones reales para volver", "not opportunities: real reasons to come back")}</span></div>
            {signals.length === 0 ? <p className="quiet-p">{t("Ninguna registrada.", "None recorded.")}</p> : (
              <ul className="x3-h">{signals.map(({ c, d }) => (
                <li key={c.id} className={c.triggerOn && c.triggerOn < now ? "attn" : "info"}>
                  <span className="mono">{c.triggerOn ? i.day(c.triggerOn) : "—"}</span>
                  <span><b>{c.what}</b><span className="src block">{t("Por qué", "Why")}: {c.basis} · {c.createdByName} · <F f={freshness(i, c.createdAt, 365, now)} src={t("registrada", "recorded")} />{c.triggerEvent ? ` · ${t("cuando", "when")} ${c.triggerEvent}` : ""} · <Link href={`/deals/${d.id}/resultado`}>{d.code}</Link></span></span>
                </li>
              ))}</ul>
            )}
          </section>

          <section className="jblock">
            <div className="jbh"><b>{t("RETENCIONES", "WITHHOLDINGS")}</b><span className="grow" /><span className="src"><Link href={`/administracion/pagos-recibidos?account=${a.id}#retenciones`}>{t("registrar", "record")}</Link></span></div>
            <Withholdings accountId={a.id} lang={i.es ? "ES" : "EN"} canRecord={false} canVoid={false} heading={false} />
          </section>

          <section className="jblock" id="mapa-pago">
            <div className="jbh"><b>{t("MAPA DE PAGO", "PAYMENT MAP")}</b><span className="grow" /><span className="src">{payMap ? t(`actualizado por ${payMap.updatedByName} · ${i.day(payMap.updatedAt)}`, `updated by ${payMap.updatedByName} · ${i.day(payMap.updatedAt)}`) : t("quién recibe, valida, aprueba, programa y paga", "who receives, validates, approves, schedules and pays")}</span></div>
            {payMap ? (
              <dl className="filedl">
                {MAP_ROLES.map(([r, label]) => { const ps = payMap.people.filter((p) => p.role === r); return ps.length ? [<dt key={`${r}-t`}>{label}</dt>, <dd key={`${r}-d`}>{ps.map((p, k) => <span key={p.id}>{k ? ", " : ""}<Link href={`/mercado/personas/${p.contact.id}`}>{p.contact.firstName} {p.contact.lastName}</Link>{p.contact.title ? ` (${p.contact.title})` : ""}</span>)}</dd>] : null; })}
                {payMap.process && <><dt>{t("Proceso", "Process")}</dt><dd>{payMap.process}</dd></>}
                {payMap.portal && <><dt>{t("Portal", "Portal")}</dt><dd>{payMap.portal}</dd></>}
                {payMap.payDays && <><dt>{t("Días / cortes de pago", "Pay days / cut-offs")}</dt><dd>{payMap.payDays}</dd></>}
                {payMap.documents && <><dt>{t("Documentos exigidos", "Required documents")}</dt><dd>{payMap.documents}</dd></>}
                {payMap.notes && <><dt>{t("Notas", "Notes")}</dt><dd>{payMap.notes}</dd></>}
              </dl>
            ) : <p className="quiet-p">{t("Aún no sabemos cómo entra y se paga una factura en este cliente. Saberlo evita facturas rechazadas y cobros a la persona equivocada.", "We don't know yet how an invoice gets in and paid at this customer. Knowing it avoids rejected invoices and chasing the wrong person.")}</p>}
            {mapEditable && (
              <details className="md-form"><summary className="small">{payMap ? t("Actualizar mapa de pago", "Update payment map") : t("Completar mapa de pago", "Fill in the payment map")}</summary>
                <form action={savePaymentMap.bind(null, a.id)} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="back" value={`/accounts/${a.id}#mapa-pago`} />
                  {a.contacts.length > 0 ? (
                    <div className="mk-scroll"><table className="small">
                      <thead><tr><th>{t("Persona", "Person")}</th>{MAP_ROLES.map(([r, label]) => <th key={r}>{label}</th>)}</tr></thead>
                      <tbody>{a.contacts.map((c) => <tr key={c.id}><td>{c.firstName} {c.lastName}</td>{MAP_ROLES.map(([r]) => <td key={r}><input type="checkbox" name={`role_${r}`} value={c.id} aria-label={`${c.firstName} ${c.lastName} · ${r}`} defaultChecked={!!payMap?.people.some((p) => p.role === r && p.contactId === c.id)} /></td>)}</tr>)}</tbody>
                    </table></div>
                  ) : <p className="src">{t("Agrega contactos del cliente para asignar quién hace cada paso.", "Add customer contacts to assign who does each step.")}</p>}
                  <label className="small">{t("Proceso (cómo entra y se aprueba una factura)", "Process (how an invoice gets in and approved)")}<textarea name="process" rows={2} defaultValue={payMap?.process ?? ""} /></label>
                  <div className="grid cols-3">
                    <label className="small">{t("Portal", "Portal")}<input name="portal" defaultValue={payMap?.portal ?? ""} /></label>
                    <label className="small">{t("Días / cortes de pago", "Pay days / cut-offs")}<input name="payDays" defaultValue={payMap?.payDays ?? ""} placeholder={t("p. ej. viernes; corte día 25", "e.g. Fridays; cut-off on the 25th")} /></label>
                    <label className="small">{t("Documentos exigidos", "Required documents")}<input name="documents" defaultValue={payMap?.documents ?? ""} /></label>
                  </div>
                  <label className="small">{t("Notas", "Notes")}<textarea name="notes" rows={2} defaultValue={payMap?.notes ?? ""} /></label>
                  <span className="src">{t("Usa las personas que ya existen; no se duplican contactos. Guarda solo lo necesario para cobrar bien.", "Uses the people that already exist; contacts aren't duplicated. Keep only what is needed to collect well.")}</span>
                  <div><button type="submit" className="sm">{t("Guardar", "Save")}</button></div>
                </form>
              </details>
            )}
          </section>
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("RELACIONES", "RELATIONSHIPS")}</b></div>
            {a.contacts.length === 0 ? <p className="quiet-p small">{t("Sin contactos.", "No contacts.")}</p> : (
              <ul className="plain small">{a.contacts.map((c) => (
                <li key={c.id}><b><Link href={`/mercado/personas/${c.id}`}>{c.firstName} {c.lastName}</Link></b>{c.title ? ` · ${c.title}` : ""}<span className="src block">{c.email ?? "—"} · <F f={freshness(i, lastTouch(c.id), 120, now)} src={t("último contacto", "last contact")} /></span></li>
              ))}</ul>
            )}
          </div>
          <div>
            <div className="jbh"><b>{t("PATRÓN DE FACTURACIÓN", "BILLING PATTERN")}</b></div>
            <dl className="filedl">
              <dt>{t("Paga", "Pays")}</dt><dd>{bp.hist.n ? (bp.hist.avg > 0 ? t(`~${bp.hist.avg} d tarde`, `~${bp.hist.avg} d late`) : t("a tiempo", "on time")) : t("sin historial", "no history")}</dd>
              <dt>{t("Promesas", "Promises")}</dt><dd>{bp.kept + bp.broken ? t(`${bp.kept} cumplidas · ${bp.broken} incumplidas`, `${bp.kept} kept · ${bp.broken} broken`) : "—"}</dd>
              <dt>{t("Pagos cortos", "Short pays")}</dt><dd>{bp.shortPays.length ? bp.shortPays.join(" · ") : t("ninguno", "none")}</dd>
              <dt>{t("Exige", "Requires")}</dt><dd>{[a.requiresReceptionCode && t("código de recepción", "receiving code"), a.requiresPortal && t("portal", "portal"), !a.allowsPartialBilling && t("factura completa", "full invoice only")].filter(Boolean).join(" · ") || t("nada especial", "nothing special")}</dd>
              <dt>{t("Abierto hoy", "Open today")}</dt><dd className="mono">USD {i.n2(bp.open)}</dd>
            </dl>
          </div>
          {editable && (
            <details className="qa"><summary className="qa-btn">{t("Crear necesidad desde este cliente", "Create need from this customer")}</summary><div className="qa-pop wide">
              <form action={createNeedFromContext} className="qa-form">
                <input type="hidden" name="accountId" value={a.id} />
                <input type="hidden" name="context" value={`Customer 360 · ${a.name}`} />
                <input type="hidden" name="back" value={`/accounts/${a.id}`} />
                <label>{t("Qué necesita el cliente", "What the customer needs")}<input name="title" required defaultValue={nextSignal?.c.what ?? ""} /></label>
                <label>{t("Contexto (lo que ya sabemos)", "Context (what we already know)")}<input name="needSpecs" defaultValue={nextSignal ? nextSignal.c.basis : installed[0] ? `${installed[0].code ?? ""} ${installed[0].description} (${i.day(installed[0].at)})` : ""} /></label>
                <button type="submit">{t("Crear y abrir", "Create and open")}</button>
              </form>
            </div></details>
          )}
          {mail.configured && recipients.length > 0 && (
            <details className="qa"><summary className="qa-btn">{t("Escribir a un contacto", "Email a contact")}</summary><div className="qa-pop wide"><EmailComposer recipients={recipients} from={mail.from!} es={i.es} /></div></details>
          )}
          <Link className="qa-btn" href={`/visitas?cliente=${a.id}#proximas`}>{t("Planear visita", "Plan visit")}</Link>
          {editable && (
            <div className="x3-edit">
              <details><summary className="small">{t("Registrar interacción", "Log interaction")}</summary>
                <form action={logActivity} className="stack">
                  <input type="hidden" name="accountId" value={a.id} />
                  <select name="type" defaultValue="CALL" aria-label={t("Tipo", "Type")}><option value="CALL">{t("Llamada", "Call")}</option><option value="MEETING">{t("Reunión", "Meeting")}</option><option value="EMAIL">{t("Correo", "Email")}</option><option value="NOTE">{t("Nota", "Note")}</option></select>
                  <input name="subject" placeholder={t("Qué pasó", "What happened")} required />
                  <ValueKindSelect es={i.es} />
                  <button type="submit" className="secondary">{t("Registrar", "Log")}</button>
                </form>
              </details>
              <details><summary className="small">{t("Agregar contacto", "Add contact")}</summary>
                <form action={createContact} className="stack">
                  <input type="hidden" name="accountId" value={a.id} />
                  <label>{t("Nombre", "First name")}<input name="firstName" required /></label>
                  <label>{t("Apellido", "Last name")}<input name="lastName" required /></label>
                  <label>{t("Correo", "Email")}<input name="email" type="email" /></label>
                  <label>{t("Cargo", "Title")}<input name="title" /></label>
                  <button type="submit">{t("Agregar", "Add")}</button>
                </form>
              </details>
              <details open={docs.length > 0}><summary className="small">{t("Documentos", "Documents")} {docs.length > 0 && `(${docs.length})`}</summary>
                {docs.length > 0 ? (
                  <ul className="plain docs-list">
                    {docs.map((d) => {
                      const ex = (d.extracted ?? null) as { fields?: Record<string, string> } | null;
                      const found = ex?.fields ? Object.entries(ex.fields) : [];
                      return (
                        <li key={d.id}>
                          <a href={`/accounts/documento/${d.id}`} target="_blank" rel="noopener"><b>{d.kind === "RUT" ? "RUT" : d.kind === "CAMARA" ? t("Cámara de Comercio", "Chamber of Commerce") : d.name}</b></a>
                          <span className="src"> · {d.kind !== "OTHER" ? `${d.name} · ` : ""}{i.day(d.createdAt)} · {Math.max(1, Math.round(d.size / 1024))} KB</span>
                          {found.length > 0 && (
                            <details className="docs-ex"><summary className="src">{t("Lo que SOLU leyó", "What SOLU read")}</summary>
                              <dl>{found.map(([k, v]) => <div key={k}><dt>{docFieldLabel(t, k)}</dt><dd>{v}</dd></div>)}</dl>
                            </details>
                          )}
                          <form action={deleteAccountDocument.bind(null, a.id, d.id)} data-confirm={t(`¿Quitar el documento ${d.name}?`, `Remove document ${d.name}?`)} style={{ display: "inline" }}>
                            <button type="submit" className="link small">{t("Quitar", "Remove")}</button>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="src">{t("Aún no hay RUT ni otros documentos.", "No RUT or other documents yet.")}</p>}
                <form action={addAccountDocuments.bind(null, a.id)} className="stack">
                  <label>{t("Agregar documentos (PDF o foto, hasta 5 MB)", "Add documents (PDF or photo, up to 5 MB)")}<input type="file" name="docs" multiple required accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
                  <button type="submit" className="secondary">{t("Subir", "Upload")}</button>
                </form>
              </details>
              <details><summary className="small">{t("Requisitos para facturar", "Invoicing requirements")}</summary>
                <form action={updateBilling.bind(null, a.id)} className="stack">
                  <label>NIT / Tax ID<input name="taxId" defaultValue={a.taxId ?? ""} /></label>
                  <label className="check"><input type="checkbox" name="taxDataComplete" defaultChecked={a.taxDataComplete} /> {t("Datos tributarios completos", "Tax data complete")}</label>
                  <label>{t("Plazo de pago (días)", "Payment terms (days)")}<input name="paymentTermsDays" type="number" min="0" defaultValue={a.paymentTermsDays} /></label>
                  <label className="check"><input type="checkbox" name="requiresReceptionCode" defaultChecked={a.requiresReceptionCode} /> {t("Exige código de recepción de mercancía", "Requires goods-receipt code")}</label>
                  <label className="check"><input type="checkbox" name="requiresPortal" defaultChecked={a.requiresPortal} /> {t("Factura por portal de proveedores", "Invoices through supplier portal")}</label>
                  <label>{t("Inscripción al portal vigente hasta", "Portal registration valid until")}<input name="portalValidUntil" type="date" defaultValue={dayInput(a.portalValidUntil)} /></label>
                  <button type="submit" className="secondary">{t("Guardar", "Save")}</button>
                </form>
              </details>
              <details><summary className="small">{t("Datos del cliente", "Customer details")}</summary>
                <form action={updateAccount.bind(null, a.id)} className="stack">
                  <label>{t("Nombre", "Name")}<input name="name" defaultValue={a.name} required /></label>
                  <label>{t("Industria", "Industry")}<input name="industry" defaultValue={a.industry ?? ""} /></label>
                  <label>{t("Sitio web", "Website")}<input name="website" type="url" defaultValue={a.website ?? ""} /></label>
                  <label>{t("Teléfono", "Phone")}<input name="phone" defaultValue={a.phone ?? ""} /></label>
                  <label>{t("Dirección", "Address")}<textarea name="address" defaultValue={a.address ?? ""} /></label>
                  {users.length > 0 && <label>{t("Responsable", "Owner")}<select name="ownerId" defaultValue={a.ownerId}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
                  <button type="submit">{t("Guardar", "Save")}</button>
                </form>
                <details style={{ marginTop: 10 }}>
                  <summary className="small">{t("Eliminar cliente", "Delete customer")}</summary>
                  <form action={deleteAccount.bind(null, a.id)}>
                    <p className="src" style={{ marginBottom: 6 }}>{t("Borra también sus Necesidades, facturas y pagos.", "Also deletes its Necessities, invoices and payments.")}</p>
                    <button className="danger sm" type="submit">{t("Eliminar definitivamente", "Delete permanently")}</button>
                  </form>
                </details>
              </details>
            </div>
          )}
          <p className="note ai">{t("Sin puntajes ni métricas de vanidad: cada dato muestra de dónde viene y qué tan fresco es.", "No scores or vanity metrics: every fact shows where it came from and how fresh it is.")}</p>
        </aside>
      </div>
      <Popovers />
    </div>
  );
}

function docFieldLabel(t: (es: string, en: string) => string, k: string) {
  const m: Record<string, [string, string]> = {
    name: ["Razón social", "Legal name"], tradeName: ["Nombre comercial", "Trade name"], taxId: ["NIT", "Tax ID"],
    address: ["Dirección", "Address"], city: ["Ciudad", "City"], department: ["Departamento", "State"],
    phone: ["Teléfono", "Phone"], email: ["Correo", "Email"], ciiu: ["Actividad CIIU", "CIIU activity"],
  };
  return m[k] ? t(m[k][0], m[k][1]) : k;
}

function daysSince(d: Date, now: Date) {
  return Math.round((now.getTime() - d.getTime()) / 864e5);
}
