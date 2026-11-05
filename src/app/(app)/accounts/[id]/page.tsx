import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput, today } from "@/lib/domain";
import { stageLabel } from "@/lib/labels";
import { basisOf, stateLabel } from "@/lib/result";
import { billingPattern, customerInclude, freshness, installedContext, type Fresh } from "@/lib/x360";
import { deleteAccount, updateAccount, updateBilling } from "../actions";
import { createContact } from "../../contacts/actions";
import { logActivity } from "../../activities/actions";
import { createNeedFromContext } from "../../productos/actions";
import { mailConfig } from "@/lib/mail";
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
  const users = canManageAll(user) ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
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
  const bp = billingPattern(a, now);
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
        <p className="jh-sub">{a.industry ?? t("Sin industria", "No industry")} · {t("Responsable", "Owner")}: {a.owner.name} · {t(`cliente desde ${i.day(a.createdAt)}`, `customer since ${i.day(a.createdAt)}`)}</p>
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
          <span className="k">{t("JOURNEYS ACTIVOS", "ACTIVE JOURNEYS")}</span>
          <b>{active.length || t("Ninguno", "None")}</b>
          <span className="src">{active.filter((d) => d.recoveries.some((r) => !r.resolvedAt)).length ? t(`${active.filter((d) => d.recoveries.some((r) => !r.resolvedAt)).length} con Recovery abierta`, `${active.filter((d) => d.recoveries.some((r) => !r.resolvedAt)).length} with an open recovery`) : t("sin Recovery abierta", "no open recovery")}</span>
        </div>
        <div className="x3-f">
          <span className="k">{t("CÓMO PAGA", "HOW THEY PAY")}</span>
          <b>{bp.hist.n ? (bp.hist.avg > 0 ? t(`~${bp.hist.avg} d después del vencimiento`, `~${bp.hist.avg} d after due`) : t("A tiempo", "On time")) : t("Sin historial", "No history")}</b>
          <span className="src">{t(`plazo ${a.paymentTermsDays} d`, `${a.paymentTermsDays}-day terms`)}{bp.hist.n ? t(` · ${bp.hist.n} factura(s) cobrada(s)`, ` · ${bp.hist.n} invoice(s) collected`) : ""}{bp.kept + bp.broken ? t(` · promesas cumplidas ${bp.kept}/${bp.kept + bp.broken}`, ` · promises kept ${bp.kept}/${bp.kept + bp.broken}`) : ""}</span>
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
            <div className="jbh"><b>{t("JOURNEYS ACTIVOS", "ACTIVE JOURNEYS")}</b><span className="grow" /><span className="src">{t("entra al Journey para actuar", "enter the Journey to act")}</span></div>
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
        </div>

        <aside className="jrail">
          <div>
            <div className="jbh"><b>{t("RELACIONES", "RELATIONSHIPS")}</b></div>
            {a.contacts.length === 0 ? <p className="quiet-p small">{t("Sin contactos.", "No contacts.")}</p> : (
              <ul className="plain small">{a.contacts.map((c) => (
                <li key={c.id}><b>{c.firstName} {c.lastName}</b>{c.title ? ` · ${c.title}` : ""}<span className="src block">{c.email ?? "—"} · <F f={freshness(i, lastTouch(c.id), 120, now)} src={t("último contacto", "last contact")} /></span></li>
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
          {editable && (
            <div className="x3-edit">
              <details><summary className="small">{t("Registrar interacción", "Log interaction")}</summary>
                <form action={logActivity} className="stack">
                  <input type="hidden" name="accountId" value={a.id} />
                  <select name="type" defaultValue="CALL" aria-label={t("Tipo", "Type")}><option value="CALL">{t("Llamada", "Call")}</option><option value="MEETING">{t("Reunión", "Meeting")}</option><option value="EMAIL">{t("Correo", "Email")}</option><option value="NOTE">{t("Nota", "Note")}</option></select>
                  <input name="subject" placeholder={t("Qué pasó", "What happened")} required />
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
                    <p className="src" style={{ marginBottom: 6 }}>{t("Borra también sus Journeys, facturas y pagos.", "Also deletes its Journeys, invoices and payments.")}</p>
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

function daysSince(d: Date, now: Date) {
  return Math.round((now.getTime() - d.getTime()) / 864e5);
}
