import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { FU_KINDS, FU_MAX, NOTE_MAX, URGENCIES, URGENCY_LABEL, applyCriteria, criteriaParams, forPerson, loadFollowUps, readCriteria, type FuCriteria, type FuItem, type FuKind, type FuSort } from "@/lib/followups";
import UrgencyPick from "./UrgencyPick";

// Comercial → Seguimientos: everything still open with customers (requests, quotes, purchase orders, deliveries,
// receivables, projects), for one customer or for all of them, filtered and ordered by the criterion the person
// picks (overdue first, urgency, Eságara). Inside a customer, several are ticked and SOLU writes ONE email for all.
export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ a?: string; c?: string; q?: string; t?: string; u?: string; o?: string; ok?: string; err?: string; r?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const all = await loadFollowUps(user);
  const find = (sp.q ?? "").trim().toLowerCase().slice(0, 60);
  const crit = readCriteria(sp);

  // Customers with something pending, the ones with more first.
  const byAccount = new Map<string, { id: string; name: string; items: FuItem[] }>();
  for (const it of all) {
    const g = byAccount.get(it.accountId) ?? { id: it.accountId, name: it.accountName, items: [] };
    g.items.push(it); byAccount.set(it.accountId, g);
  }
  const companies = [...byAccount.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  const sel = sp.a ? byAccount.get(sp.a) ?? null : null;
  const shownCompanies = find ? companies.filter((c) => c.name.toLowerCase().includes(find) || c.items.some((x) => (x.contactName ?? "").toLowerCase().includes(find)) || c.id === sel?.id) : companies;

  // People of the chosen customer: those something is assigned to, then the rest of its contacts (they can receive too).
  const contacts = sel ? await db.contact.findMany({ where: { accountId: sel.id }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], select: { id: true, firstName: true, lastName: true, title: true, email: true } }) : [];
  const people = contacts.map((c) => ({ ...c, name: `${c.firstName} ${c.lastName}`.trim(), n: sel!.items.filter((x) => x.contactId === c.id).length })).sort((a, b) => b.n - a.n);
  const who = sel && sp.c ? people.find((p) => p.id === sp.c) ?? null : null;
  // The scope (one customer, one person, or everyone), then the criterion on top of it.
  const scope = sel ? forPerson(sel.items, who?.id ?? null) : all;
  const shown = applyCriteria(scope, crit);
  const hidden = sel ? sel.items.length - scope.length : 0;
  const noPerson = sel ? sel.items.filter((x) => x.contactId === null).length : 0;

  const KIND: Record<FuKind, { name: string; title: string; hint: string; ask: string }> = {
    N: { name: t("Solicitudes", "Requests"), title: t("SOLICITUDES ABIERTAS", "OPEN REQUESTS"), hint: t("Necesidades que aún no tienen una cotización presentada al cliente.", "Needs that do not have a quote presented to the customer yet."), ask: t("p. ej. ¿nos envía la foto de la placa?", "e.g. could you send the nameplate photo?") },
    Q: { name: t("Cotizaciones", "Quotes"), title: t("COTIZACIONES SIN DECISIÓN", "QUOTES WITHOUT A DECISION"), hint: t("Presentadas al cliente; aún no dice sí ni no.", "Presented to the customer; no yes or no yet."), ask: t("p. ej. ¿pudieron revisarla con mantenimiento?", "e.g. were you able to review it with maintenance?") },
    O: { name: t("Órdenes de compra", "Purchase orders"), title: t("ÓRDENES DE COMPRA SIN ENTREGAR", "PURCHASE ORDERS NOT DELIVERED"), hint: t("Órdenes de compra del cliente de las que aún no se entrega nada.", "Customer purchase orders with nothing delivered yet."), ask: t("p. ej. ¿quién recibe en planta?", "e.g. who receives at the plant?") },
    E: { name: t("Entregas", "Deliveries"), title: t("ENTREGAS EN CURSO", "DELIVERIES IN PROGRESS"), hint: t("Entregas al cliente en preparación o en camino.", "Deliveries to the customer in preparation or on their way."), ask: t("p. ej. ¿nos confirma el horario de recibo?", "e.g. can you confirm the receiving hours?") },
    I: { name: t("Cartera", "Receivables"), title: t("CARTERA POR COBRAR", "RECEIVABLES TO COLLECT"), hint: t("Facturas con saldo. Un pago cuenta cuando Tesorería lo concilia.", "Invoices with a balance. A payment counts once Treasury reconciles it."), ask: t("p. ej. ¿nos confirma la fecha de pago?", "e.g. can you confirm the payment date?") },
    P: { name: t("Proyectos", "Projects"), title: t("PROYECTOS ABIERTOS", "OPEN PROJECTS"), hint: t("Proyectos de «Proyectos y notas» enlazados a este cliente.", "Projects from “Projects & notes” linked to this customer."), ask: t("p. ej. nos falta recibir el logo en alta resolución", "e.g. we still need the high-resolution logo") },
  };
  const SORT: Record<FuSort, string> = {
    mora: t("Más vencidas primero", "Most overdue first"), urg: t("Por urgencia", "By urgency"),
    esmax: t("Mayor Eságara primero", "Highest Eságara first"), esmin: t("Menor Eságara primero", "Lowest Eságara first"),
  };
  // Every link keeps the customer, the person and the criterion; `over` changes one of them.
  const href = (over: { a?: string | null; c?: string | null; crit?: Partial<FuCriteria> }) => {
    const a = over.a !== undefined ? over.a : sel?.id ?? null;
    const c = over.c !== undefined ? over.c : over.a !== undefined ? null : who?.id ?? null;
    const p = new URLSearchParams({ ...(a ? { a } : {}), ...(a && c ? { c } : {}), ...(find ? { q: find } : {}), ...criteriaParams({ ...crit, ...over.crit }) });
    const s = p.toString();
    return `/cotizaciones/seguimientos${s ? `?${s}` : ""}`;
  };
  const errs: Record<string, string> = {
    nada: t("Marca al menos un pendiente para generar el correo.", "Tick at least one pending item to generate the email."),
    cambio: t("Esos pendientes ya no están abiertos o no son tuyos. Elige de nuevo.", "Those items are no longer open or are not yours. Choose again."),
  };
  const days = (n: number) => (n === 1 ? t("1 día", "1 day") : t(`${n} días`, `${n} days`));
  const when = (it: FuItem) => {
    const d = i.day(it.at);
    if (it.kind === "P") return { tone: it.late ? "attn" : "wait", text: t(`Último movimiento ${d}`, `Last movement ${d}`) };
    if (!it.at) return { tone: "dash", text: t("Sin fecha", "No date") };
    const tone = it.late ? (it.kind === "Q" ? "attn" : "risk") : it.kind === "Q" ? "info" : "ok";
    const text = it.kind === "Q" ? (it.late ? t(`Validez vencida ${d}`, `Validity ended ${d}`) : t(`Válida hasta ${d}`, `Valid until ${d}`))
      : it.kind === "I" ? (it.late ? t(`Venció ${d}`, `Was due ${d}`) : t(`Vence ${d}`, `Due ${d}`))
      : it.kind === "E" ? (it.late ? t(`Debía entregarse ${d}`, `Was to be delivered ${d}`) : t(`Entrega ${d}`, `Delivery ${d}`))
      : it.kind === "O" ? (it.late ? t(`Fecha pedida pasó ${d}`, `Required date passed ${d}`) : t(`Para ${d}`, `For ${d}`))
      : it.late ? t(`Fecha pasó ${d}`, `Date passed ${d}`) : t(`Para ${d}`, `For ${d}`);
    return { tone, text };
  };
  const kindsHere = FU_KINDS.filter((k) => scope.some((x) => x.kind === k));
  const scopeName = who ? who.name : sel ? sel.name : t("todos los clientes", "all customers");

  return (
    <div className="qlist fu">
      <div className="ph" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t("Seguimientos", "Follow-ups")}</h1>
          <p className="src">{t("Todo lo que sigue abierto con tus clientes, con el criterio que elijas. Dentro de un cliente, marca varios pendientes y SOLU arma un solo correo de seguimiento para todos.", "Everything still open with your customers, by the criterion you choose. Inside a customer, tick several items and SOLU writes a single follow-up email for all of them.")}</p>
        </div>
        <div className="grow" />
        <Link className="btn secondary" href="/cotizaciones">{t("Cotizaciones presentadas", "Quotes presented")}</Link>
      </div>
      {sp.ok === "correo" && <p className="note okn">{t("Seguimiento enviado desde la cuenta de la empresa. Quedó registrado en el cliente y en cada pendiente («Último seguimiento»).", "Follow-up sent from the company account. It is logged on the customer and on each item (“Last follow-up”).")}{sp.r && /^\d{4}-\d{2}-\d{2}$/.test(sp.r) ? ` ${t(`Te queda un pendiente en MI DÍA → Pendientes para el ${i.day(new Date(`${sp.r}T00:00:00Z`))}, para revisar si respondieron.`, `A to-do is in MY DAY → To-dos for ${i.day(new Date(`${sp.r}T00:00:00Z`))}, to check whether they replied.`)}` : ""}</p>}
      {sp.err && errs[sp.err] && <p className="note attn">{errs[sp.err]}</p>}

      {all.length === 0 ? (
        <p className="quiet-p">{t("No tienes pendientes con clientes: ni solicitudes abiertas, ni cotizaciones sin decisión, ni órdenes de compra o entregas en curso, ni facturas con saldo, ni proyectos enlazados a un cliente.", "You have nothing pending with customers: no open requests, no quotes without a decision, no purchase orders or deliveries in progress, no invoices with a balance, no projects linked to a customer.")}</p>
      ) : (
        <div className="fu-grid">
          <section className="qzone fu-pick" id="cliente">
            <h2>{t("1 · CLIENTE Y PERSONA", "1 · CUSTOMER AND PERSON")}</h2>
            <p className="src">{t("El número es cuántos pendientes tiene cada uno.", "The number is how many pending items each one has.")}</p>
            {companies.length > 8 && (
              <form method="get" className="fu-find">
                {sel && <input type="hidden" name="a" value={sel.id} />}
                {Object.entries(criteriaParams(crit)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                <input name="q" defaultValue={find} placeholder={t("Buscar cliente o persona…", "Find a customer or person…")} aria-label={t("Buscar cliente o persona", "Find a customer or person")} />
                <button type="submit" className="secondary">{t("Buscar", "Find")}</button>
              </form>
            )}
            <ul className="fu-cos">
              <li className={!sel ? "on" : undefined}>
                <Link href={href({ a: null })} className="fu-co" aria-current={!sel ? "true" : undefined}><b>{t("Todos los clientes", "All customers")}</b><span className="fu-n">{all.length}</span></Link>
              </li>
              {shownCompanies.map((co) => (
                <li key={co.id} className={co.id === sel?.id ? "on" : undefined}>
                  <Link href={href({ a: co.id })} className="fu-co" aria-current={co.id === sel?.id ? "true" : undefined}><b>{co.name}</b><span className="fu-n">{co.items.length}</span></Link>
                  {co.id === sel?.id && (
                    <ul className="fu-people">
                      <li><Link href={href({ c: null })} className={!who ? "on" : undefined}><span>{t("Toda la empresa", "The whole company")}</span><span className="fu-n">{co.items.length}</span></Link></li>
                      {people.map((p) => (
                        <li key={p.id}><Link href={href({ c: p.id })} className={who?.id === p.id ? "on" : undefined}><span>{p.name}{p.title ? <span className="src"> · {p.title}</span> : null}{!p.email && <span className="src"> · {t("sin correo", "no email")}</span>}</span><span className="fu-n">{p.n}</span></Link></li>
                      ))}
                      {people.length === 0 && <li className="src">{t("Esta empresa no tiene contactos guardados. Agrégalos en su ficha de cliente.", "This company has no saved contacts. Add them on its customer record.")}</li>}
                    </ul>
                  )}
                </li>
              ))}
              {shownCompanies.length === 0 && <li className="src">{t("Ningún cliente coincide con la búsqueda.", "No customer matches the search.")}</li>}
            </ul>
          </section>

          <form method="get" action="/cotizaciones/seguimientos/correo" className="fu-form">
            {sel && <input type="hidden" name="a" value={sel.id} />}
            {who && <input type="hidden" name="c" value={who.id} />}
            <section className="qzone" id="criterio">
              <h2>{t("2 · CRITERIO", "2 · CRITERION")}</h2>
              <p className="src">{t("Qué ver y en qué orden. Se aplica a lo que elegiste a la izquierda.", "What to see and in which order. It applies to what you chose on the left.")}</p>
              <div className="fu-crit">
                <span className="fu-crit-k">{t("Ver", "Show")}</span>
                <div className="fu-chips">
                  <Link href={href({ crit: { kind: null } })} className={!crit.kind ? "on" : undefined}>{t("Todo", "Everything")} <span className="fu-n">{scope.length}</span></Link>
                  {kindsHere.map((k) => <Link key={k} href={href({ crit: { kind: k } })} className={crit.kind === k ? "on" : undefined}>{KIND[k].name} <span className="fu-n">{scope.filter((x) => x.kind === k).length}</span></Link>)}
                </div>
                <span className="fu-crit-k">{t("Urgencia", "Urgency")}</span>
                <div className="fu-chips">
                  <Link href={href({ crit: { urgency: null } })} className={!crit.urgency ? "on" : undefined}>{t("Todas", "All")}</Link>
                  {URGENCIES.map((u) => <Link key={u} href={href({ crit: { urgency: u } })} className={crit.urgency === u ? "on" : undefined}>{t(URGENCY_LABEL[u].es, URGENCY_LABEL[u].en)} <span className="fu-n">{scope.filter((x) => x.urgency === u).length}</span></Link>)}
                  <Link href={href({ crit: { urgency: "NONE" } })} className={crit.urgency === "NONE" ? "on" : undefined}>{t("Sin marcar", "Not marked")} <span className="fu-n">{scope.filter((x) => x.urgency === null).length}</span></Link>
                </div>
                <span className="fu-crit-k">{t("Orden", "Order")}</span>
                <div className="fu-chips">
                  {(Object.keys(SORT) as FuSort[]).map((s) => <Link key={s} href={href({ crit: { sort: s } })} className={crit.sort === s ? "on" : undefined}>{SORT[s]}</Link>)}
                </div>
              </div>
            </section>

            <section className="qzone">
              <h2>{t("3 · PENDIENTES DE", "3 · PENDING WITH")} {scopeName.toUpperCase()} · {shown.length}</h2>
              <p className="src">
                {who
                  ? t(`Lo que está a nombre de ${who.name} en ${sel!.name}${noPerson ? `, más ${noPerson} de la empresa sin persona asignada` : ""}.`, `What is with ${who.name} at ${sel!.name}${noPerson ? `, plus ${noPerson} of the company with no person assigned` : ""}.`)
                  : sel
                    ? t(`Todos los pendientes de ${sel.name}. Elige una persona a la izquierda para ver solo los suyos.`, `Every pending item of ${sel.name}. Choose a person on the left to see only theirs.`)
                    : t("Los pendientes de todos tus clientes juntos. Para enviar un correo de seguimiento, entra a un cliente: con el nombre de la fila o en la lista de la izquierda.", "The pending items of all your customers together. To send a follow-up email, go into a customer: with the name on the row or in the list on the left.")}
                {hidden > 0 && <> {t(`Hay ${hidden} más a nombre de otras personas:`, `${hidden} more are with other people:`)} <Link href={href({ c: null })}>{t("ver toda la empresa", "see the whole company")}</Link>.</>}
              </p>
              {sel && <p className="src">{t(`Marca los que van en el correo (hasta ${FU_MAX}). En cada uno puedes escribir qué necesitas del cliente: sale en el correo, junto a ese punto.`, `Tick the ones that go in the email (up to ${FU_MAX}). On each you can write what you need from the customer: it goes in the email, next to that point.`)}</p>}
              {shown.length === 0 && <p className="quiet-p">{scope.length === 0 ? t("Esta persona no tiene pendientes a su nombre.", "This person has nothing pending.") : <>{t("Nada coincide con este criterio.", "Nothing matches this criterion.")} <Link href={href({ crit: { kind: null, urgency: null } })}>{t("Quitar los filtros", "Clear the filters")}</Link></>}</p>}
            </section>
            {FU_KINDS.map((k) => {
              const list = shown.filter((x) => x.kind === k);
              if (!list.length) return null;
              const s = KIND[k];
              return (
                <section key={k} className="qzone">
                  <h2>{s.title} · {list.length}</h2>
                  <p className="src">{s.hint} {t("Orden:", "Order:")} {SORT[crit.sort].toLowerCase()}.</p>
                  {list.map((it) => {
                    const w = when(it);
                    return (
                      <div key={it.key} className={`fu-row${sel ? "" : " all"}`}>
                        {sel && <label className="fu-chk"><input type="checkbox" name="k" value={it.key} aria-label={`${it.title} ${it.sub}`} /></label>}
                        <div className="fu-what">
                          {!sel && <Link className="fu-acc" href={href({ a: it.accountId })}>{it.accountName}</Link>}
                          <b><Link href={it.href}>{it.title}</Link></b>
                          <span className="src">{it.sub}{it.sub ? " · " : ""}{it.contactName ?? t("sin persona asignada", "no person assigned")}</span>
                        </div>
                        <div className="fu-state">
                          {it.balance != null && <b className="mono">{i.money2(it.balance)} </b>}
                          <span className={`sig ${w.tone}`}>{w.text}</span>
                          {it.late && it.mora != null && it.mora > 0 && it.kind !== "P" && <span className="src block">{t(`${days(it.mora)} de mora`, `${days(it.mora)} overdue`)}</span>}
                          {it.kind === "P" && it.late && <span className="src block">{t(`${days(it.mora ?? 0)} más del límite sin movimiento`, `${days(it.mora ?? 0)} past the limit without movement`)}</span>}
                          <span className="src block">{it.lastAt ? t(`Último seguimiento: ${i.day(it.lastAt)}`, `Last follow-up: ${i.day(it.lastAt)}`) : t("Sin seguimiento por correo todavía", "No email follow-up yet")}</span>
                        </div>
                        <div className="fu-val">
                          {it.kind === "P"
                            ? <span className={`sig ${it.urgency ? URGENCY_LABEL[it.urgency].tone : "dash"}`}>{it.urgency ? t(`Prioridad ${URGENCY_LABEL[it.urgency].es.toLowerCase()}`, `${URGENCY_LABEL[it.urgency].en} priority`) : t("Sin prioridad", "No priority")}</span>
                            : it.dealId && it.canMark
                              ? <UrgencyPick dealId={it.dealId} value={it.urgency} es={i.es} about={it.title} />
                              : <span className={`sig ${it.urgency ? URGENCY_LABEL[it.urgency].tone : "dash"}`}>{it.urgency ? t(`Urgencia ${URGENCY_LABEL[it.urgency].es.toLowerCase()}`, `${URGENCY_LABEL[it.urgency].en} urgency`) : t("Urgencia: sin marcar", "Urgency: not marked")}</span>}
                          {it.kind !== "P" && <span className="src block">{it.esagara != null ? <>Eságara <b className="mono">{i.money2(it.esagara)}</b></> : t("Eságara: aún sin calcular", "Eságara: not calculated yet")}</span>}
                        </div>
                        {sel && <input className="fu-note" name={`n_${it.key}`} maxLength={NOTE_MAX} placeholder={s.ask} aria-label={t(`Qué necesitas del cliente sobre ${it.title}`, `What you need from the customer about ${it.title}`)} />}
                      </div>
                    );
                  })}
                </section>
              );
            })}
            {sel && shown.length > 0 && (
              <div className="loc-rowacts fu-go">
                <button type="submit">{t("Generar correo de seguimiento", "Generate follow-up email")}</button>
                <span className="src">{t("No envía nada todavía: abre el correo ya escrito para que lo revises.", "Nothing is sent yet: it opens the email already written for you to review.")}</span>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
