import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n, type I18n } from "@/lib/i18n";
import { canDecideCredit, canEditMoney, canEditOps, canFinance, canManageAll } from "@/lib/permissions";
import { dayInput } from "@/lib/domain";
import { loadCashJourney, type CashJourney } from "@/lib/cash-journey";
import { CLASS_LABEL, PROMISE_LABEL, REASONS, ROOT_CAUSES, ROOT_CAUSE_LABEL, STEP_KINDS, STEP_LABEL, agingLabels, type CashStage } from "@/lib/cash-rules";
import { ALT_LABEL, CashBags, causeText, kindLabel, LEAK_LABEL, reasonText } from "@/components/CashBags";
import { statusTone } from "@/lib/cash-journey";
import { recordPromise } from "../../administracion/actions";
import { addInvoiceStep, requestCreditReview, resolveBlocker, saveBlocker, setCollectNext, withdrawCreditReview } from "./actions";

// Comercial C3 · Money Desk / "Mi dinero por mover" (§56). One financial truth (Finance), shown as what Comercial can move.

type SP = { scope?: string; ok?: string; err?: string };

const ERR: Record<string, [string, string]> = {
  permiso: ["No tienes permiso para cambiar este registro.", "You don't have permission to change this record."],
  motivo: ["Elige el motivo.", "Choose the reason."],
  causa: ["Elige la causa raíz.", "Choose the root cause."],
  narrativa: ["Cuenta qué pasa, en una o dos frases.", "Say what is happening, in a sentence or two."],
  movimiento: ["Escribe el próximo movimiento (o qué se espera y hasta cuándo).", "Write the next move (or what you wait for and until when)."],
  responsable: ["Elige a la persona responsable.", "Choose the responsible person."],
  valor: ["Revisa el valor: debe ser un número positivo.", "Check the value: it must be a positive number."],
  paso: ["Elige qué pasó con la factura.", "Choose what happened with the invoice."],
  "fecha-paso": ["La fecha debe estar entre la emisión y hoy.", "The date must be between issue and today."],
  "motivo-rechazo": ["Un rechazo necesita el motivo: es lo que hay que corregir.", "A rejection needs its reason: it is what must be fixed."],
  tipo: ["Elige el tipo de solicitud.", "Choose the request type."],
  "motivo-cupo": ["Explica por qué lo pides.", "Explain why you ask."],
  "monto-cupo": ["Indica el cupo que propones.", "Enter the limit you propose."],
  plazo: ["Indica el plazo en días que propones.", "Enter the proposed terms in days."],
  horizonte: ["Una excepción temporal necesita fecha de fin.", "A temporary exception needs an end date."],
  "cupo-pendiente": ["Este cliente ya tiene una solicitud abierta.", "This customer already has an open request."],
};
const OK: Record<string, [string, string]> = {
  bloqueo: ["Causa y próximo movimiento guardados.", "Cause and next move saved."],
  resuelto: ["Bloqueo resuelto. Queda en el historial.", "Blocker resolved. It stays in the history."],
  paso: ["Paso de la factura registrado.", "Invoice step recorded."],
  movimiento: ["Próximo movimiento guardado.", "Next move saved."],
  "cupo-pedido": ["Solicitud enviada a Finanzas / Gerencia.", "Request sent to Finance / Management."],
  "cupo-retirado": ["Solicitud retirada.", "Request withdrawn."],
};

export default async function MoneyDesk({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const i = makeI18n(user.lang);
  const { t } = i;
  const wide = canManageAll(user) || canFinance(user);
  const team = sp.scope === "team" || (sp.scope !== "mine" && wide);
  const [j, users] = await Promise.all([
    loadCashJourney(i, team ? {} : { ownerId: user.id }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const back = `/comercial/dinero${team ? "?scope=team" : "?scope=mine"}`;
  const ag = agingLabels(j.policy.value.aging);
  const daysTxt = (n: number) => t(`${n} ${n === 1 ? "día" : "días"}`, `${n} ${n === 1 ? "day" : "days"}`);

  const BlockerForm = ({ dealId, stage, ids, readyAt, value, cur }: { dealId: string; stage: CashStage; ids: { shipmentId?: string | null; deliveryId?: string; invoiceId?: string }; readyAt?: Date; value: number; cur?: CashJourney["deliver"][number]["blocker"] }) => (
    <details className="md-form" open={false}>
      <summary className="small">{cur ? t("Actualizar causa y movimiento", "Update cause and move") : t("Registrar causa y próximo movimiento", "Record cause and next move")}</summary>
      <form action={saveBlocker.bind(null, dealId)} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="stage" value={stage} />
        {cur && <input type="hidden" name="id" value={cur.id} />}
        {ids.shipmentId && <input type="hidden" name="shipmentId" value={ids.shipmentId} />}
        {ids.deliveryId && <input type="hidden" name="deliveryId" value={ids.deliveryId} />}
        {ids.invoiceId && <input type="hidden" name="invoiceId" value={ids.invoiceId} />}
        {readyAt && <input type="hidden" name="readyAt" value={dayInput(readyAt)} />}
        <div className="grid cols-3">
          <label className="small">{t("Motivo", "Reason")}<select name="reasonCode" required defaultValue={cur?.reasonCode ?? ""}><option value="" disabled>—</option>{REASONS[stage].map((r) => <option key={r.code} value={r.code}>{t(r.es, r.en)}</option>)}</select></label>
          <label className="small">{t("Causa raíz (quién controla el tiempo)", "Root cause (who controls the time)")}<select name="rootCause" defaultValue={cur?.rootCause ?? ""}><option value="">{t("la habitual del motivo", "the reason's usual one")}</option>{ROOT_CAUSES.map((c) => <option key={c} value={c}>{t(...ROOT_CAUSE_LABEL[c])}</option>)}</select></label>
          <label className="small">{t("Causa secundaria (opcional)", "Secondary cause (optional)")}<select name="secondaryCause" defaultValue={cur?.secondaryCause ?? ""}><option value="">—</option>{ROOT_CAUSES.map((c) => <option key={c} value={c}>{t(...ROOT_CAUSE_LABEL[c])}</option>)}</select></label>
        </div>
        <label className="small">{t("Qué pasa", "What is happening")}<textarea name="narrative" rows={2} required defaultValue={cur?.narrative ?? ""} /></label>
        <div className="grid cols-3">
          <label className="small">{t("Próximo movimiento", "Next move")}<input name="nextMovement" required defaultValue={cur?.nextMovement ?? ""} /></label>
          <label className="small">{t("Responsable del movimiento", "Responsible for the move")}<select name="responsibleId" defaultValue={cur?.responsible.id ?? user.id}>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="small">{t("Se espera resolver el", "Expected resolution")}<input type="date" name="expectedResolution" defaultValue={dayInput(cur?.expectedResolution)} /></label>
        </div>
        <div className="grid cols-3">
          <label className="small">{t("Evidencia (opcional)", "Evidence (optional)")}<input name="evidence" defaultValue={cur?.evidence ?? ""} placeholder={t("correo, acta, número…", "email, record, number…")} /></label>
          <label className="small">{t("Valor detenido (USD)", "Value held (USD)")}<input name="blockedValue" inputMode="decimal" defaultValue={cur ? Number(cur.blockedValue) : value} /></label>
          {!cur && <label className="small">{t("Detenido desde", "Held since")}<input type="date" name="blockedSince" defaultValue={dayInput(readyAt ?? j.now)} /></label>}
        </div>
        <span className="src">{t("La causa raíz puede ser de otra área o del cliente; el responsable es quien mueve el siguiente paso. No es lo mismo.", "The root cause can be another area or the customer; the responsible person moves the next step. They are not the same.")}</span>
        <div><button type="submit" className="sm">{t("Guardar", "Save")}</button></div>
      </form>
    </details>
  );

  const BlockerView = ({ b, stage }: { b: NonNullable<CashJourney["deliver"][number]["blocker"]>; stage: CashStage }) => (
    <div className="md-blk">
      <span><b>{reasonText(i, stage, b.reasonCode)}</b> · {t("causa", "cause")}: {causeText(i, b.rootCause)}{b.secondaryCause ? ` + ${causeText(i, b.secondaryCause)}` : ""} · {t("desde", "since")} {i.day(b.blockedSince)}</span>
      <span className="small">{b.narrative}{b.evidence ? <span className="src"> · {b.evidence}</span> : null}</span>
      <span className="small"><b>{t("Próximo movimiento", "Next move")}:</b> {b.nextMovement} · {b.responsible.name}{b.expectedResolution ? t(` · se espera el ${i.day(b.expectedResolution)}`, ` · expected ${i.day(b.expectedResolution)}`) : ""}</span>
      <details className="md-form"><summary className="small">{t("Marcar resuelto", "Mark resolved")}</summary>
        <form action={resolveBlocker.bind(null, b.id)} className="inline"><input type="hidden" name="back" value={back} /><input name="resolvedNote" required placeholder={t("Qué lo resolvió", "What resolved it")} style={{ flex: 1 }} /><button type="submit" className="secondary sm">{t("Resuelto", "Resolved")}</button></form>
      </details>
    </div>
  );

  const Att = ({ a }: { a: { total: number; COMPANY: number; CUSTOMER: number; EXTERNAL: number; unexplained: number } }) => a.total > 0 ? (
    <span className="src">{t("De esos días", "Of those days")}: {(["CUSTOMER", "EXTERNAL", "COMPANY"] as const).filter((k) => a[k] > 0).map((k) => `${t(...CLASS_LABEL[k]).toLowerCase()} ${a[k]}`).join(" · ")}{a.unexplained > 0 ? `${a.unexplained < a.total ? " · " : ""}${t("sin causa registrada", "no cause recorded")} ${a.unexplained}` : ""}</span>
  ) : null;

  const msg = sp.err ? ERR[sp.err] ?? ["No se pudo guardar.", "Could not save."] : null;
  const okm = sp.ok ? OK[sp.ok] : null;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Comercial", "Commercial")}</div>
          <h1>{t("Dinero por mover", "Money to move")}</h1>
          <p>{t("Una venta termina cuando se convierte en caja. Aquí está lo que falta entregar, facturar, cobrar o liberar en crédito: cuánto vale, por qué está detenido y quién lo mueve. Los saldos vienen de Administración; aquí no se editan.", "A sale ends when it becomes cash. Here is what is left to deliver, invoice, collect or free up in credit: what it is worth, why it is stopped and who moves it. Balances come from Administration; they aren't edited here.")}</p>
        </div>
        <div className="seg">
          <Link href="/comercial/dinero?scope=mine" className={!team ? "on" : ""}>{t("Lo mío", "Mine")}</Link>
          <Link href="/comercial/dinero?scope=team" className={team ? "on" : ""}>{t("Todo el equipo", "Whole team")}</Link>
        </div>
      </div>
      {msg && <p className="card small risk-t" role="alert">{t(...msg)}</p>}
      {okm && <p className="card small ok-t" role="status">{t(...okm)}</p>}

      <CashBags j={j} i={i} />

      <section className="sum" style={{ marginTop: 16 }}>
        <div><span className="k">{t("Capital comprometido", "Committed capital")}</span><span className="v">{i.money(j.capital.total)}</span><span className="s">{j.capital.monthlyCost != null ? t(`financiarlo cuesta ~${i.money(j.capital.monthlyCost)} al mes (${i.pct2(j.capital.annualPct)} anual)`, `financing it costs ~${i.money(j.capital.monthlyCost)} a month (${i.pct2(j.capital.annualPct)} a year)`) : t("vender a crédito es financiar al cliente", "selling on credit means financing the customer")}</span></div>
        <div><span className="k">{t("Facturas abiertas", "Open invoices")}</span><span className="v">{i.money(j.capital.ar)}</span></div>
        <div><span className="k">{t("Aceptado sin facturar", "Accepted, not invoiced")}</span><span className="v">{i.money(j.capital.committed)}</span><span className="s">{t(`incluye ${i.money(j.capital.readyGoods)} en mercancía lista`, `includes ${i.money(j.capital.readyGoods)} in ready goods`)}</span></div>
        {j.commission && (team ? canManageAll(user) : true) && <div><span className="k">{t("Comisión esperando recaudo", "Commission waiting for collection")}</span><span className="v">{i.money(j.commission.total)}</span><span className="s">{t("se libera con el dinero conciliado", "released with reconciled cash")}</span></div>}
      </section>
      <p className="src">{t("Capital comprometido = facturas abiertas + Necesidades ganadas sin facturar. La mercancía lista ya está dentro de lo no facturado; no se suma dos veces.", "Committed capital = open invoices + won Necessities not yet invoiced. Ready goods are already inside the uninvoiced part; not counted twice.")}{" "}<Link href="/comercial/fugas">{t("Ver fugas de caja y tiempos", "See cash leakage and delays")}</Link></p>

      {/* 1 · ENTREGAR */}
      <section className="mk-sec" id="entregar">
        <h2>{t("Entregar", "Deliver")} <span className="src">{t(`mercancía lista que no se ha entregado · alerta después de ${j.policy.value.readyAlertDays} días calendario`, `ready goods not delivered · alert after ${j.policy.value.readyAlertDays} calendar days`)}</span></h2>
        {j.deliver.length === 0 ? <div className="card empty"><span className="sig ok">{t("Nada listo esperando entrega.", "Nothing ready waiting for delivery.")}</span></div> : j.deliver.map((x) => (
          <article key={x.key} id={x.key} className={`card md-item ${x.alert && !x.blocker ? "move" : ""}`}>
            <div className="md-top"><Link href={`/deals/${x.dealId}`}><b>{x.dealCode} · {x.title}</b></Link><span className="val">{i.money(x.value)}</span></div>
            <span className="small">{x.account} · {x.ownerName} · {x.refs.join(", ")} · {t(`listo desde ${i.day(x.readyAt)} (${daysTxt(x.days)})`, `ready since ${i.day(x.readyAt)} (${daysTxt(x.days)})`)} {x.alert && <span className={`sig ${x.blocker ? "wait" : "attn"}`}>{t(`más de ${j.policy.value.readyAlertDays} días`, `over ${j.policy.value.readyAlertDays} days`)}</span>}</span>
            <Att a={x.att} />
            {x.blocker ? <BlockerView b={x.blocker} stage="DELIVER" /> : <p className="small muted">{t("Sin causa registrada. Si no se puede entregar, dilo aquí para que el tiempo se atribuya a quien lo controla.", "No cause recorded. If it can't be delivered, say so here so the time is attributed to whoever controls it.")}</p>}
            {(canEditMoney(user, x.ownerId) || canEditOps(user, x.ownerId)) && <BlockerForm dealId={x.dealId} stage="DELIVER" ids={{ shipmentId: x.shipmentId }} readyAt={x.readyAt} value={x.value} cur={x.blocker} />}
          </article>
        ))}
      </section>

      {/* 2 · FACTURAR */}
      <section className="mk-sec" id="facturar">
        <h2>{t("Facturar", "Invoice")} <span className="src">{t(`entregado sin factura · alerta después de ${j.policy.value.deliveredAlertWorkingDays} días hábiles (lunes a viernes, sin festivos)`, `delivered without invoice · alert after ${j.policy.value.deliveredAlertWorkingDays} working days (Mon–Fri, holidays not counted)`)}</span></h2>
        {j.invoice.length === 0 ? <div className="card empty">{t("Todo lo entregado está facturado.", "Everything delivered is invoiced.")}</div> : j.invoice.map((x) => (
          <article key={x.key} id={x.key} className={`card md-item ${x.alert && !x.blocker ? "move" : ""}`}>
            <div className="md-top"><Link href={`/deals/${x.dealId}#facturacion`}><b>{x.ref} · {x.dealCode}</b></Link><span className="val">{i.money(x.value)}</span></div>
            <span className="small">{x.account} · {x.ownerName} · {t(`entregado el ${i.day(x.deliveredAt)} · ${x.workingDays} días hábiles`, `delivered on ${i.day(x.deliveredAt)} · ${x.workingDays} working days`)} {x.alert && <span className={`sig ${x.blocker ? "wait" : "attn"}`}>{t("ya debería estar facturado", "should be invoiced by now")}</span>}</span>
            <Att a={x.att} />
            {x.missing.length ? (
              <ul className="mk-ul">{x.missing.map((m) => <li key={m.key} className="small"><b>{m.label}</b> — {m.detail} <span className="src">{t("suele depender de", "usually depends on")}: {causeText(i, m.cause)}{m.request ? t(` · pedido el ${i.day(m.request.at)}`, ` · requested ${i.day(m.request.at)}`) : ""}</span></li>)}</ul>
            ) : <p className="small ok-t">{t("Todo lo que el cliente exige está. Se puede emitir la factura.", "Everything the customer requires is on file. The invoice can be issued.")} <Link href={`/deals/${x.dealId}#facturacion`}>{t("Ir a facturar", "Go invoice")}</Link></p>}
            {x.blocker && <BlockerView b={x.blocker} stage="INVOICE" />}
            {canEditMoney(user, x.ownerId) && <BlockerForm dealId={x.dealId} stage="INVOICE" ids={{ deliveryId: x.deliveryId }} readyAt={x.deliveredAt} value={x.value} cur={x.blocker} />}
          </article>
        ))}
      </section>

      {/* 3 · COBRAR */}
      <section className="mk-sec" id="cobrar">
        <h2>{t("Cobrar", "Collect")} <span className="src">{t("vencimiento del contrato ≠ fecha esperada ≠ promesa ≠ dinero conciliado", "contractual due ≠ expected date ≠ promise ≠ reconciled cash")}</span></h2>
        {j.collect.length === 0 ? <div className="card empty"><span className="sig ok">{t("No hay facturas abiertas.", "No open invoices.")}</span></div> : j.collect.map((x) => {
          const can = canEditMoney(user, x.ownerId);
          return (
            <article key={x.key} id={x.key} className={`card md-item ${x.needs ? "move" : ""}`}>
              <div className="md-top"><Link href={`/deals/${x.dealId}#facturacion`}><b>{t("Factura", "Invoice")} {x.number} · {x.account}</b></Link><span className="val">{i.money2(x.value)}</span></div>
              <span className="small">{x.dealCode} · {x.ownerName} · <span className={`sig ${x.conf.stage === "REJECTED" ? "risk" : x.conf.confirmed ? "ok" : "wait"}`}>{t(...STEP_LABEL[x.conf.stage])}{x.conf.at ? ` · ${i.day(x.conf.at)}` : ""}</span> <span className={`sig ${x.aging.late > 0 ? "attn" : "wait"}`}>{t(...ag[x.aging.idx])}</span> {x.leak && <span className="sig risk">{t(...LEAK_LABEL[x.leak])}</span>}</span>
              {x.conf.stage === "REJECTED" && <p className="small risk-t"><b>{t("Motivo del rechazo", "Rejection reason")}:</b> {x.conf.reason} — {t("corrígelo y vuelve a radicar antes de perseguir a Tesorería del cliente.", "fix it and resubmit before chasing the customer's Treasury.")}</p>}
              <dl className="md-truths">
                <div><dt>{t("Vence (contrato)", "Due (contract)")}</dt><dd>{i.day(x.dueAt)}</dd></div>
                <div><dt>{t("Esperado por SOLU", "Expected by SOLU")}</dt><dd>{x.view.expected.date ? i.day(x.view.expected.date) : "—"}<span className="src block">{x.view.expected.basis}</span></dd></div>
                <div><dt>{t("Promesa vigente", "Current promise")}</dt><dd>{x.latest ? <>{i.day(x.latest.p.promisedFor)}{x.latest.p.amount ? ` · ${i.money2(x.latest.p.amount)}` : ""} <span className={`sig ${statusTone(x.latest.status)}`}>{t(...PROMISE_LABEL[x.latest.status])}</span><span className="src block">{x.latest.p.promisedBy}{x.latest.p.promisedByRole ? ` (${x.latest.p.promisedByRole})` : ""}</span></> : "—"}</dd></div>
                <div><dt>{t("Dinero conciliado", "Reconciled cash")}</dt><dd>{i.money2(x.cash.reconciled)}{x.cash.pendingReconcile > 0.005 && <span className="src block">{t(`${i.money2(x.cash.pendingReconcile)} recibidos sin conciliar`, `${i.money2(x.cash.pendingReconcile)} received, not reconciled`)}</span>}</dd></div>
              </dl>
              <div className="md-blk">
                <span className="small"><b>{x.collectWaitingFor ? t("Esperando con control", "Waiting under control") : t("Próximo movimiento", "Next move")}:</b> {x.collectWaitingFor ? `${x.collectWaitingFor}${x.collectNextAt ? t(` · hasta ${i.day(x.collectNextAt)}`, ` · until ${i.day(x.collectNextAt)}`) : ""}` : x.collectNext ? `${x.collectNext}${x.collectNextAt ? ` · ${i.day(x.collectNextAt)}` : ""}` : <span className="muted">{t("sin definir", "not defined")}</span>}{x.collectContact ? ` · ${x.collectContact}` : ""}{x.collectByName ? <span className="src"> · {x.collectByName}{x.collectAt ? `, ${i.day(x.collectAt)}` : ""}</span> : null}</span>
              </div>
              {x.blocker && <BlockerView b={x.blocker} stage="COLLECT" />}
              {x.promises.length > 1 && (
                <details className="md-form"><summary className="small">{t(`Historial de promesas (${x.promises.length})`, `Promise history (${x.promises.length})`)}</summary>
                  <ul className="mk-ul">{x.promises.map((p) => <li key={p.p.id} className="small">{i.day(p.p.createdAt)}: {p.p.promisedBy} {t("prometió", "promised")} {p.p.amount ? i.money2(p.p.amount) : t("el saldo", "the balance")} {t("para el", "for")} {i.day(p.p.promisedFor)} <span className={`sig ${statusTone(p.status)}`}>{t(...PROMISE_LABEL[p.status])}</span>{p.got > 0.005 && p.status !== "KEPT" ? <span className="src"> · {t("llegó", "arrived")} {i.money2(p.got)}</span> : null}<span className="src"> · {p.p.source}</span></li>)}</ul>
                </details>
              )}
              {x.steps.length > 0 && (
                <details className="md-form"><summary className="small">{t(`Pasos de la factura (${x.steps.length})`, `Invoice steps (${x.steps.length})`)}</summary>
                  <ul className="mk-ul">{x.steps.map((s) => <li key={s.id} className="small">{i.day(s.at)} · <b>{t(...STEP_LABEL[s.kind as keyof typeof STEP_LABEL])}</b>{s.reference ? ` · ${s.reference}` : ""}{s.reason ? ` — ${s.reason}` : ""}<span className="src"> · {s.byName}</span></li>)}</ul>
                </details>
              )}
              {can && (
                <div className="md-forms">
                  <details className="md-form"><summary className="small">{t("Registrar paso de la factura", "Record an invoice step")}</summary>
                    <form action={addInvoiceStep.bind(null, x.invoiceId)} className="grid cols-3">
                      <input type="hidden" name="back" value={back} />
                      <label className="small">{t("Qué pasó", "What happened")}<select name="kind" required defaultValue=""><option value="" disabled>—</option>{STEP_KINDS.map((k) => <option key={k} value={k}>{t(...STEP_LABEL[k])}</option>)}</select></label>
                      <label className="small">{t("Fecha", "Date")}<input type="date" name="at" defaultValue={dayInput(j.now)} max={dayInput(j.now)} /></label>
                      <label className="small">{t("Radicado / referencia", "Filing / reference")}<input name="reference" /></label>
                      <label className="small" style={{ gridColumn: "1 / -1" }}>{t("Motivo (obligatorio si fue rechazada)", "Reason (required if rejected)")}<input name="reason" /></label>
                      <div><button type="submit" className="sm">{t("Registrar", "Record")}</button></div>
                    </form>
                  </details>
                  <details className="md-form"><summary className="small">{t("Próximo movimiento o espera", "Next move or wait")}</summary>
                    <form action={setCollectNext.bind(null, x.invoiceId)} className="grid cols-3">
                      <input type="hidden" name="back" value={back} />
                      <label className="small">{t("Tipo", "Type")}<select name="mode" defaultValue={x.collectWaitingFor ? "wait" : "move"}><option value="move">{t("Lo muevo yo", "I move it")}</option><option value="wait">{t("Espero con control", "Wait under control")}</option></select></label>
                      <label className="small">{t("Movimiento", "Move")}<input name="collectNext" defaultValue={x.collectNext ?? ""} placeholder={t("p. ej. confirmar con cuentas por pagar", "e.g. confirm with accounts payable")} /></label>
                      <label className="small">{t("Espero que…", "Waiting for…")}<input name="collectWaitingFor" defaultValue={x.collectWaitingFor ?? ""} placeholder={t("p. ej. la corrida de pagos del viernes", "e.g. Friday's payment run")} /></label>
                      <label className="small">{t("Fecha (o hasta cuándo)", "Date (or until when)")}<input type="date" name="collectNextAt" defaultValue={dayInput(x.collectNextAt)} /></label>
                      <label className="small">{t("Con quién", "With whom")}<input name="collectContact" defaultValue={x.collectContact ?? ""} /></label>
                      <div style={{ alignSelf: "end" }}><button type="submit" className="sm">{t("Guardar", "Save")}</button></div>
                    </form>
                  </details>
                  <details className="md-form"><summary className="small">{x.latest?.status === "OPEN" ? t("Nueva promesa (reemplaza la vigente)", "New promise (replaces the current one)") : t("Registrar promesa de pago", "Record a payment promise")}</summary>
                    <form action={recordPromise.bind(null, x.invoiceId)} className="grid cols-3">
                      <label className="small">{t("Fecha prometida", "Promised date")}<input type="date" name="promisedFor" required min={dayInput(j.now)} /></label>
                      <label className="small">{t("Monto (vacío = todo el saldo)", "Amount (empty = full balance)")}<input name="amount" inputMode="decimal" placeholder={i.n2(x.open)} /></label>
                      <label className="small">{t("Quién lo prometió", "Who promised")}<input name="promisedBy" required /></label>
                      <label className="small">{t("Su cargo", "Their role")}<input name="promisedByRole" placeholder={t("p. ej. Tesorería", "e.g. Treasury")} /></label>
                      <label className="small">{t("Fuente / evidencia", "Source / evidence")}<input name="source" required placeholder={t("llamada, correo del 12-nov…", "call, email of Nov 12…")} /></label>
                      <div style={{ alignSelf: "end" }}><button type="submit" className="sm">{t("Guardar promesa", "Save promise")}</button></div>
                    </form>
                    <span className="src">{t("Una promesa nunca borra otra: la anterior queda como «reemplazada» con su historia.", "A promise never erases another: the previous one stays as “replaced” with its history.")}</span>
                  </details>
                  <BlockerForm dealId={x.dealId} stage="COLLECT" ids={{ invoiceId: x.invoiceId }} value={x.value} cur={x.blocker} />
                </div>
              )}
            </article>
          );
        })}
      </section>

      {/* 4 · LIBERAR CRÉDITO */}
      <section className="mk-sec" id="credito">
        <h2>{t("Liberar crédito", "Free up credit")} <span className="src">{t("Comercial ve y solicita; Finanzas o Gerencia deciden", "Commercial sees and requests; Finance or Management decide")}</span></h2>
        {j.credit.length === 0 ? <div className="card empty"><span className="sig ok">{t("Ningún cliente cerca o por encima del cupo.", "No customer near or over the limit.")}</span></div> : j.credit.map((x) => (
          <article key={x.key} id={x.key} className={`card md-item ${x.needs ? "move" : ""}`}>
            <div className="md-top"><Link href={`/accounts/${x.accountId}`}><b>{x.account}</b></Link><span className={`sig ${x.over ? "risk" : "attn"}`}>{x.over ? t("Excede el cupo", "Over limit") : t("Cerca del cupo", "Near limit")}</span></div>
            <dl className="md-truths">
              <div><dt>{t("Cupo aprobado", "Approved limit")}</dt><dd>{i.money(x.limit)}</dd></div>
              <div><dt>{t("Facturas abiertas", "Open invoices")}</dt><dd>{i.money(x.openInvoices)}{x.overdue > 0.005 && <span className="src block">{t(`${i.money(x.overdue)} vencidos`, `${i.money(x.overdue)} overdue`)}</span>}</dd></div>
              <div><dt>{t("Aceptado sin facturar", "Accepted, not invoiced")}</dt><dd>{i.money(x.committed)}</dd></div>
              <div><dt>{t("Disponible", "Available")}</dt><dd className={x.available < 0 ? "risk-t" : ""}>{i.money(x.available)}</dd></div>
            </dl>
            {x.blocking.length > 0 && <p className="small">{t("Bloqueadas", "Blocked")}: {x.blocking.map((d, k) => <span key={d.id}>{k ? ", " : ""}<Link href={`/deals/${d.id}`}>{d.code}</Link> ({i.money(d.amount)})</span>)}</p>}
            {x.review ? (
              <div className="md-blk">
                <span className="small"><b>{t("Solicitud abierta", "Open request")}:</b> {kindLabel(i, x.review.kind)} · {x.review.requestedBy.name} · {i.day(x.review.createdAt)}</span>
                <span className="small">{x.review.reason}</span>
                {x.review.requestedById === user.id && <form action={withdrawCreditReview.bind(null, x.review.id)} className="inline"><input type="hidden" name="back" value={`${back}#credito`} /><button type="submit" className="secondary sm">{t("Retirar solicitud", "Withdraw request")}</button></form>}
              </div>
            ) : (
              <>
                <div className="grid cols-3 md-alts">
                  <div><b className="small">{t("Esperar el pago", "Wait for payment")}</b><p className="src">{t(`Conciliar ${i.money(x.openInvoices)} abiertos libera cupo.`, `Reconciling ${i.money(x.openInvoices)} open frees the limit.`)}</p></div>
                  <div><b className="small">{t("Anticipo o pago previo", "Prepayment")}</b><p className="src">{x.over ? t(`Un anticipo de ${i.money(x.used - x.limit)} deja la cuenta dentro del cupo.`, `A prepayment of ${i.money(x.used - x.limit)} brings it within the limit.`) : t("Reduce la exposición de la próxima orden.", "Reduces the next order's exposure.")}</p></div>
                  <div><b className="small">{t("Dividir la orden o entrega", "Split the order or delivery")}</b><p className="src">{t("Entregar y facturar por partes mantiene la exposición bajo el cupo.", "Delivering and invoicing in parts keeps exposure under the limit.")}</p></div>
                </div>
                <CreditForm i={i} accountId={x.accountId} deals={x.blocking} back={`${back}#credito`} limit={x.limit} />
              </>
            )}
          </article>
        ))}
        {canDecideCredit(user) && j.openReviews.length > 0 && <p className="small"><Link href="/administracion/cupos#solicitudes">{(j.openReviews.length === 1 ? t("1 solicitud de cupo espera tu decisión", "1 credit request awaits your decision") : t(`${j.openReviews.length} solicitudes de cupo esperan tu decisión`, `${j.openReviews.length} credit requests await your decision`))}</Link></p>}
      </section>
    </>
  );
}

function CreditForm({ i, accountId, deals, back, limit }: { i: I18n; accountId: string; deals: { id: string; code: string | null }[]; back: string; limit: number }) {
  const { t } = i;
  return (
    <details className="md-form"><summary className="small">{t("Solicitar revisión de cupo", "Request a credit review")}</summary>
      <form action={requestCreditReview.bind(null, accountId)} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="back" value={back} />
        <div className="grid cols-3">
          <label className="small">{t("Tipo", "Type")}<select name="kind" required defaultValue="INCREASE">{["INCREASE", "TEMPORARY_EXCEPTION", "TERMS_REVIEW", "DECREASE"].map((k) => <option key={k} value={k}>{kindLabel(i, k)}</option>)}</select></label>
          <label className="small">{t("Cupo propuesto (USD)", "Proposed limit (USD)")}<input name="requestedLimit" inputMode="decimal" placeholder={i.n(limit)} /></label>
          <label className="small">{t("Plazo propuesto (días)", "Proposed terms (days)")}<input name="requestedTerms" inputMode="numeric" /></label>
          <label className="small">{t("Hasta (excepción temporal)", "Until (temporary exception)")}<input type="date" name="until" /></label>
          <label className="small">{t("Necesidad relacionada", "Related Necessity")}<select name="dealId" defaultValue={deals[0]?.id ?? ""}><option value="">—</option>{deals.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</select></label>
        </div>
        <label className="small">{t("Por qué", "Why")}<textarea name="reason" rows={2} required /></label>
        <label className="small">{t("Información relevante (opcional)", "Relevant information (optional)")}<textarea name="info" rows={2} /></label>
        <fieldset className="small"><legend>{t("Alternativas que ya ofrecimos o el cliente acepta", "Alternatives already offered or accepted by the customer")}</legend>
          {Object.entries(ALT_LABEL).map(([k, l]) => <label key={k} className="row" style={{ gap: 6 }}><input type="checkbox" name="alternatives" value={k} />{t(...l)}</label>)}
        </fieldset>
        <span className="src">{t("Decide Finanzas o Gerencia, nunca quien pide. Se guarda una foto de la exposición y del comportamiento de pago de hoy.", "Finance or Management decides, never the requester. A snapshot of today's exposure and payment behavior is kept.")}</span>
        <div><button type="submit" className="sm">{t("Enviar solicitud", "Send request")}</button></div>
      </form>
    </details>
  );
}
