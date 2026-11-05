import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { bankDiscrepancies, dayInput, paymentState } from "@/lib/domain";
import { paymentStateLabel } from "@/lib/labels";
import { stageLabel } from "@/lib/labels";
import { buildJourney, journeyInclude, typeLabel, type TabKey, type Tone } from "@/lib/journey";
import { OutlookNote } from "@/components/OutlookNote";
import { Popovers } from "@/components/Popovers";
import {
  acceptCustomerPo,
  addItem,
  confirmFact,
  deleteDeal,
  markJourneySeen,
  markQuoteSent,
  removeItem,
  saveFile,
  saveNeed,
  savePromise,
  saveQuote,
  saveResult,
  saveSourcing,
  setCarrierEta,
  setNextMove,
  setWaiting,
} from "../actions";
import { defineNext, doneAndNext, logHappened, newPromise, postpone, scheduleMove, scheduleMoveAt } from "../../mi-dia/actions";
import { createSupplierPo, markSupplierPo } from "../../operaciones/actions";
import { createQuote } from "../../cotizaciones/actions";
import { prepareSpo } from "../../compras/actions";

const TAB_ORDER: TabKey[] = ["resumen", "need", "source", "quote", "execute", "finance", "file", "result"];

const Spark = ({ s = 12 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" /></svg>
);

export default async function JourneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; ok?: string; cal?: string; t?: string; d?: string }>;
}) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TAB_ORDER as string[]).includes(sp.tab ?? "") ? (sp.tab as TabKey) : "resumen";

  const deal = await db.deal.findUnique({ where: { id }, include: journeyInclude });
  if (!deal) notFound();

  // "What changed since my last visit": a new visit starts after 2 hours away.
  const view = await db.journeyView.findUnique({ where: { userId_dealId: { userId: user.id, dealId: id } } });
  const nowTs = new Date();
  let since: Date | null = view?.prevSeenAt ?? null;
  if (!view) await db.journeyView.create({ data: { userId: user.id, dealId: id, seenAt: nowTs } });
  else if (nowTs.getTime() - view.seenAt.getTime() > 2 * 3600e3) {
    since = view.seenAt;
    await db.journeyView.update({ where: { userId_dealId: { userId: user.id, dealId: id } }, data: { prevSeenAt: view.seenAt, seenAt: nowTs } });
  } else await db.journeyView.update({ where: { userId_dealId: { userId: user.id, dealId: id } }, data: { seenAt: nowTs } });

  const [suppliers, contacts, quotes] = await Promise.all([
    tab === "execute" ? db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    tab === "file" ? db.contact.findMany({ where: { accountId: deal.accountId }, orderBy: { firstName: "asc" }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
    tab === "quote" ? db.quote.findMany({ where: { dealId: id }, orderBy: [{ number: "desc" }, { rev: "desc" }], select: { id: true, number: true, rev: true, status: true, lines: { select: { qty: true, unitPrice: true } } } }) : Promise.resolve([]),
  ]);

  const J = buildJourney(deal, i, user.id, since);
  const editable = canEdit(user, deal.ownerId);
  const self = `/deals/${deal.id}`;
  const backUrl = tab === "resumen" ? self : `${self}?tab=${tab}`;

  const nowB = new Date(Date.now() - 5 * 3600e3);
  const todayStr = nowB.toISOString().slice(0, 10);
  const tomorrowStr = new Date(nowB.getTime() + 864e5).toISOString().slice(0, 10);

  const tabLabel: Record<TabKey, string> = {
    resumen: t("Resumen", "Summary"),
    need: t("Necesidad", "Need"),
    source: t("Fuente", "Source"),
    quote: t("Cotización", "Quote"),
    execute: t("Ejecución", "Execute"),
    finance: t("Finanzas", "Finance"),
    file: t("Expediente", "Business File"),
    result: t("Resultado", "Result"),
  };
  const shown = TAB_ORDER.filter((k) => k === "resumen" || J.has[k as Exclude<TabKey, "resumen">] || k === tab);
  const later = TAB_ORDER.filter((k) => !shown.includes(k));

  const okMsg: Record<string, string> = {
    need: t("Necesidad guardada.", "Need saved."),
    promise: t("Promesa al cliente guardada. Queda en «Qué cambió».", "Customer promise saved. It shows in “What changed”."),
    source: t("Fuente y costos guardados.", "Source and costs saved."),
    quote: t("Cotización guardada.", "Quote saved."),
    "quote-sent": t("Cotización marcada como enviada.", "Quote marked as sent."),
    eta: t("ETA del transportista registrada. SOLU recalculó su fecha esperada.", "Carrier ETA recorded. SOLU recalculated its expected date."),
    confirmed: t("Hecho confirmado.", "Fact confirmed."),
    result: t("Resultado guardado.", "Result saved."),
    file: t("Expediente guardado.", "Business file saved."),
    seen: t("Listo: los cambios quedan marcados como vistos.", "Done: changes marked as seen."),
    siguiente: t("Siguiente movimiento guardado.", "Next movement saved."),
    espera: t("Espera con control guardada.", "Controlled wait saved."),
    hecho: t("Movimiento hecho y registrado.", "Movement done and logged."),
    pospuesto: t(`Pospuesto al ${sp.d ?? ""}.`, `Postponed to ${sp.d ?? ""}.`),
    registrado: t("Registrado en el Journey.", "Logged on the Journey."),
    promesa: t("Promesa de pago registrada.", "Payment promise recorded."),
    reservado: t(`Tiempo reservado a las ${sp.t ?? ""}.`, `Time reserved at ${sp.t ?? ""}.`),
    agendado: t(`Agendado a las ${sp.t ?? ""}.`, `Scheduled at ${sp.t ?? ""}.`),
    "sin-dato": t("Escribe un movimiento o lo que esperas.", "Write a movement or what you're waiting for."),
    "sin-fecha": t("Elige una fecha.", "Pick a date."),
  };

  const H = ({ tb = tab }: { tb?: TabKey }) => (
    <>
      <input type="hidden" name="tab" value={tb} />
      <input type="hidden" name="back" value={tb === "resumen" ? self : `${self}?tab=${tb}`} />
    </>
  );
  const QA = ({ label, children, wide, right, cls = "" }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; right?: boolean; cls?: string }) => (
    <details className={`qa ${cls}`}>
      <summary className="qa-btn">{label}</summary>
      <div className={`qa-pop${wide ? " wide" : ""}${right ? " right" : ""}`}>{children}</div>
    </details>
  );
  const toneCls = (tn: Tone) => (tn === "risk" ? "risk" : tn === "move" ? "attn" : tn === "clarity" ? "info" : tn === "ok" ? "ok" : "wait");
  const dateMono = (d: Date | null | undefined) => (d ? i.dateShort(d) : "—");

  // ---------- Reusable pieces ----------
  const FactForm = ({ phase, tb = tab, label = t("+ Agregar un hecho", "+ Add a fact") }: { phase: string; tb?: TabKey; label?: string }) =>
    !editable ? null : (
      <QA label={label} wide>
        <form action={logHappened.bind(null, deal.id)} className="qa-form">
          <H tb={tb} />
          <input type="hidden" name="phase" value={phase} />
          <b>{t("¿Qué sabemos?", "What do we know?")}</b>
          <input name="subject" required maxLength={200} placeholder={t("Ej.: el cliente necesita 2 bombas de respaldo", "E.g.: customer needs 2 backup pumps")} />
          <div className="qa-row">
            <select name="type" defaultValue="NOTE" aria-label={t("Tipo", "Type")}>
              <option value="NOTE">{t("Nota", "Note")}</option>
              <option value="CALL">{t("Llamada", "Call")}</option>
              <option value="EMAIL">{t("Correo", "Email")}</option>
              <option value="MEETING">{t("Reunión", "Meeting")}</option>
            </select>
            <input name="occurredAt" type="date" defaultValue={todayStr} aria-label={t("Fecha", "Date")} />
          </div>
          <label>{t("Fuente (quién o qué lo dice)", "Source (who or what says so)")}<input name="source" maxLength={200} placeholder={t("Ej.: correo de Carlos Duarte", "E.g.: email from Carlos Duarte")} /></label>
          <label className="chk"><input type="checkbox" name="uncertain" value="1" /> {t("Aún no está confirmado", "Not confirmed yet")}</label>
          <button type="submit">{t("Guardar en el Journey", "Save to the Journey")}</button>
        </form>
      </QA>
    );

  const PhaseLog = ({ phase, title, empty }: { phase: string; title: string; empty: string }) => {
    const rows = deal.activities.filter((a) => a.phase === phase);
    return (
      <section className="jblock">
        <div className="jbh"><b>{title}</b><span className="grow" /><FactForm phase={phase} /></div>
        {rows.length === 0 ? <p className="quiet-p">{empty}</p> : (
          <div className="facts">
            {rows.map((a) => (
              <div key={a.id} className={`fact${a.uncertain ? " uncertain" : ""}`}>
                <div>{a.subject}{a.body && <span className="muted"> — {a.body}</span>}</div>
                <span className="when">{i.day(a.occurredAt)} · {a.source ?? `${typeLabel(i, a.type)} · ${a.user.name}`}</span>
                {a.uncertain && editable && (
                  <div className="frow">
                    <span className="sig dash">{t("Sin confirmar", "Unconfirmed")}</span>
                    <QA label={t("Confirmar manualmente", "Confirm manually")}>
                      <form action={confirmFact.bind(null, a.id)} className="qa-form">
                        <H />
                        <label>{t("¿Quién lo confirmó?", "Who confirmed it?")}<input name="source" defaultValue={a.source ?? ""} placeholder={t("Ej.: llamada con el cliente", "E.g.: call with the customer")} /></label>
                        <button type="submit">{t("Confirmar", "Confirm")}</button>
                      </form>
                    </QA>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const CarrierForm = ({ po, label }: { po: (typeof deal.supplierPos)[number]; label: string }) =>
    !editable ? null : (
      <QA label={label} wide>
        <form action={setCarrierEta.bind(null, po.id)} className="qa-form">
          <H />
          <b>{t(`ETA del transportista · ${po.code}`, `Carrier ETA · ${po.code}`)}</b>
          <div className="qa-row">
            <input name="carrierName" defaultValue={po.carrierName ?? ""} placeholder={t("Transportista", "Carrier")} aria-label={t("Transportista", "Carrier")} />
            <input name="tracking" defaultValue={po.tracking ?? ""} placeholder={t("Guía", "Tracking")} aria-label={t("Guía", "Tracking")} />
          </div>
          <label>{t("Fecha que da el transportista", "Date the carrier gives")}<input name="carrierEta" type="date" defaultValue={dayInput(po.carrierEta)} required /></label>
          <label>{t("Fuente", "Source")}<input name="carrierEtaSource" placeholder={t("Ej.: tracking web, correo del agente", "E.g.: tracking site, agent email")} /></label>
          <span className="src">{t("Es la verdad del transportista. SOLU calcula aparte cuándo lo tiene el cliente.", "This is the carrier's truth. SOLU separately calculates when the customer has it.")}</span>
          <button type="submit">{t("Guardar ETA", "Save ETA")}</button>
        </form>
      </QA>
    );

  const PromiseForm = ({ label = t("Cambiar promesa", "Change promise") }: { label?: string }) =>
    !editable ? null : (
      <QA label={label} wide right>
        <form action={savePromise.bind(null, deal.id)} className="qa-form">
          <H />
          <label>{t("Qué le prometimos", "What we promised")}<input name="promiseText" maxLength={300} defaultValue={deal.promiseText ?? ""} placeholder={t("Ej.: 2 bombas instaladas en planta", "E.g.: 2 pumps installed on site")} /></label>
          <label>{t("Para cuándo", "By when")}<input name="promisedDate" type="date" defaultValue={dayInput(deal.promisedDate)} /></label>
          <label>{t("Fuente del cambio", "Source of the change")}<input name="source" placeholder={t("Ej.: acordado en llamada con Carlos", "E.g.: agreed on a call with Carlos")} /></label>
          <span className="src">{t("La promesa es lo que dijimos al cliente. No cambia sola cuando cambia la ETA.", "The promise is what we told the customer. It doesn't change by itself when the ETA does.")}</span>
          <button type="submit">{t("Guardar promesa", "Save promise")}</button>
        </form>
      </QA>
    );

  const NeedForm = ({ inline }: { inline?: boolean }) => {
    const form = (
      <form action={saveNeed.bind(null, deal.id)} className={inline ? "stack jform" : "qa-form"}>
        <H />
        <label>{t("Resultado deseado: qué quiere lograr el cliente", "Desired result: what the customer wants to achieve")}<textarea name="desiredResult" defaultValue={deal.desiredResult ?? ""} rows={2} placeholder={t("Ej.: que la línea 2 no pare más de 4 horas por falla de bomba", "E.g.: line 2 never stops more than 4 hours for a pump failure")} /></label>
        <label>{t("Qué se necesita (especificaciones)", "What is needed (specifications)")}<textarea name="needSpecs" defaultValue={deal.needSpecs ?? ""} rows={3} placeholder={t("Ej.: 2 bombas dosificadoras 50 L/h, 10 bar, acero 316", "E.g.: 2 dosing pumps 50 L/h, 10 bar, 316 steel")} /></label>
        <div className="qa-row">
          <label style={{ flex: "1 1 140px" }}>{t("Lo necesita para", "Needed by")}<input name="neededBy" type="date" defaultValue={dayInput(deal.neededBy)} /></label>
          <label style={{ flex: "2 1 200px" }}>{t("Cómo se mide el éxito", "How success is measured")}<input name="successMeasure" defaultValue={deal.successMeasure ?? ""} placeholder={t("Ej.: 0 paradas en 90 días", "E.g.: 0 stops in 90 days")} /></label>
        </div>
        <label>{t("Qué le cuesta no resolverlo", "What it costs not to solve it")}<input name="impactIfNot" defaultValue={deal.impactIfNot ?? ""} placeholder={t("Ej.: USD 8.000 por día de línea parada", "E.g.: USD 8,000 per day of downtime")} /></label>
        <button type="submit">{t("Guardar necesidad", "Save need")}</button>
      </form>
    );
    if (inline) return form;
    return !editable ? null : <QA label={deal.desiredResult ? t("Editar", "Edit") : t("Escribir resultado deseado", "Write desired result")} wide>{form}</QA>;
  };

  const ForwardActions = () => {
    if (!editable || J.lost) return null;
    const title = deal.nextMove ?? deal.waitingFor ?? "";
    return (
      <div className="qa-bar">
        {J.forward.mode !== "none" && (
          <QA label={J.forward.mode === "wait" ? t("✓ Ya llegó", "✓ It arrived") : t("✓ Hecho", "✓ Done")} wide>
            <form action={doneAndNext.bind(null, deal.id)} className="qa-form">
              <H />
              <b>{J.forward.mode === "wait" ? t("Llegó lo que esperabas. ¿Qué sigue?", "What you waited for arrived. What's next?") : t("Hecho. ¿Qué sigue?", "Done. What's next?")}</b>
              <label>{t("Qué pasó (opcional)", "What happened (optional)")}<input name="note" /></label>
              <label>{t("Siguiente movimiento", "Next move")}<input name="nextMove" defaultValue={J.suggestion?.what ?? ""} /></label>
              <label>{t("o quedo esperando a…", "or I'm now waiting for…")}<input name="waitingFor" /></label>
              <label>{t("Para el / hasta el", "On / until")}<input name="nextDate" type="date" defaultValue={tomorrowStr} /></label>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </QA>
        )}
        <QA label={J.forward.mode === "none" ? t("Definir qué sigue", "Set what's next") : t("Cambiar", "Change")} wide>
          <form action={defineNext.bind(null, deal.id)} className="qa-form">
            <H />
            <label>{t("Siguiente movimiento", "Next move")}<input name="nextMove" defaultValue={deal.nextMove ?? (J.forward.mode === "none" ? J.suggestion?.what ?? "" : "")} /></label>
            <label>{t("o quedo esperando a…", "or I'm waiting for…")}<input name="waitingFor" defaultValue={deal.waitingFor ?? ""} /></label>
            <label>{t("Para el / hasta el", "On / until")}<input name="nextDate" type="date" defaultValue={dayInput(deal.nextMoveDate ?? deal.waitingUntil) || todayStr} /></label>
            <button type="submit">{t("Guardar", "Save")}</button>
          </form>
        </QA>
        {J.forward.mode !== "none" && (
          <QA label={J.forward.mode === "wait" ? t("Extender espera", "Extend wait") : t("Posponer", "Postpone")}>
            <form action={postpone.bind(null, deal.id)} className="qa-form">
              <H />
              <div className="qa-row">
                <button type="submit" name="days" value="1" className="secondary">{t("Mañana", "Tomorrow")}</button>
                <button type="submit" name="days" value="3" className="secondary">{t("3 días", "3 days")}</button>
                <button type="submit" name="days" value="7" className="secondary">{t("1 semana", "1 week")}</button>
              </div>
              <div className="qa-row"><input name="date" type="date" defaultValue={tomorrowStr} /><button type="submit">{t("A esa fecha", "To that date")}</button></div>
            </form>
          </QA>
        )}
        {J.forward.mode === "move" && (
          <QA label={t("Agendar", "Schedule")}>
            <div className="qa-form">
              {user.outlookConnectedAt && (
                <form action={scheduleMove.bind(null, deal.id, title)}>
                  <input type="hidden" name="back" value={backUrl} />
                  <button type="submit" className="wide">{t("Primer espacio libre", "First free slot")}</button>
                </form>
              )}
              <form action={scheduleMoveAt.bind(null, deal.id, title)} className="qa-form">
                <input type="hidden" name="back" value={backUrl} />
                <b>{t("o a esta hora", "or at this time")}</b>
                <div className="qa-row">
                  <input name="date" type="date" defaultValue={dayInput(deal.nextMoveDate) || todayStr} required />
                  <input name="time" type="time" defaultValue="09:00" step={900} required />
                  <select name="minutes" defaultValue="30" aria-label={t("Duración", "Duration")}>{[15, 30, 45, 60, 90].map((x) => <option key={x} value={x}>{x} min</option>)}</select>
                </div>
                <button type="submit" className="secondary">{t("Agendar", "Schedule")}</button>
              </form>
            </div>
          </QA>
        )}
        <QA label={t("Registrar lo que pasó", "Log what happened")}>
          <form action={logHappened.bind(null, deal.id)} className="qa-form">
            <H />
            <select name="type" defaultValue="CALL" aria-label={t("Tipo", "Type")}>
              <option value="CALL">{t("Llamada", "Call")}</option>
              <option value="EMAIL">{t("Correo", "Email")}</option>
              <option value="MEETING">{t("Reunión", "Meeting")}</option>
              <option value="NOTE">{t("Nota", "Note")}</option>
            </select>
            <input name="subject" required placeholder={t("Qué pasó, en una línea", "What happened, in one line")} />
            <button type="submit">{t("Registrar", "Log")}</button>
          </form>
        </QA>
      </div>
    );
  };

  // ---------- Blocks ----------
  const ThreeTruths = () => (
    <section className="truths" aria-label={t("Tres verdades", "Three truths")}>
      <div className="truth">
        <span className="k">{t("ETA del transportista", "Carrier ETA")}</span>
        {J.carrier ? (
          <>
            <b className="tv">{dateMono(J.carrier.date)}</b>
            <span className="tsub">{J.carrier.fallback ? t("Aún no hay ETA del transportista; esta es la del proveedor", "No carrier ETA yet; this is the supplier's") : J.carrier.who}</span>
            <span className="src">{J.carrier.src}{J.carrier.reportedAt ? ` · ${t("reportada", "reported")} ${i.day(J.carrier.reportedAt)}` : ""}</span>
            {(J.carrier.stale || J.carrier.late) && <span className="sig dash">{J.carrier.late ? t("Fecha pasada sin llegada", "Date passed, not arrived") : t("Desactualizada", "Out of date")}</span>}
            <CarrierForm po={J.carrier.po} label={J.carrier.fallback ? t("Registrar ETA del transportista", "Record carrier ETA") : t("Actualizar ETA", "Update ETA")} />
          </>
        ) : (
          <>
            <b className="tv muted">—</b>
            <span className="tsub">{deal.supplierPos.length ? (deal.supplierPos.every((p) => p.receivedAt) ? t("Todo llegó a bodega", "Everything arrived") : t("Sin ETA todavía", "No ETA yet")) : t("Sin compra todavía", "No purchase yet")}</span>
            {deal.supplierPos.find((p) => !p.receivedAt) && <CarrierForm po={deal.supplierPos.find((p) => !p.receivedAt)!} label={t("Registrar ETA", "Record ETA")} />}
          </>
        )}
      </div>
      <div className="truth solu">
        <span className="k"><Spark s={11} /> {t("SOLU espera", "SOLU expected")}</span>
        <b className="tv">{J.expected.date ? `${J.expected.done ? "" : "≈ "}${dateMono(J.expected.date)}` : "—"}</b>
        <span className="tsub">{J.expected.done ? t("Entregado", "Delivered") : t("Cuándo lo tiene el cliente", "When the customer has it")}</span>
        <span className="src">{J.expected.calc}</span>
      </div>
      <div className={`truth promise ${J.promiseState.tone}`}>
        <span className="k">{t("Promesa al cliente", "Customer promise")}</span>
        <b className="tv">{dateMono(J.promise.date)}</b>
        <span className="tsub">{J.promise.text ?? t("Sin texto de promesa", "No promise text")}</span>
        <span className={`sig ${toneCls(J.promiseState.tone)}`}>{J.promiseState.text}</span>
        <PromiseForm label={J.promise.date ? t("Cambiar promesa", "Change promise") : t("Registrar promesa", "Record promise")} />
      </div>
    </section>
  );

  const NowFacts = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("AHORA", "NOW")}</b><span>{t("hechos con fecha y fuente", "facts with date and source")}</span><span className="grow" /><FactForm phase="now" /></div>
      {J.nowFacts.length === 0 ? <p className="quiet-p">{t("Aún no hay hechos registrados. Agrega lo primero que sepas del cliente.", "No facts recorded yet. Add the first thing you know about the customer.")}</p> : (
        <div className="facts">
          {J.nowFacts.map((f) => (
            <div key={f.key} className={`fact${f.uncertain ? " uncertain" : ""}`}>
              <div>{f.text}</div>
              <span className="when">{f.when ? i.day(f.when) : "—"} · {f.src}</span>
              {f.uncertain && editable && (
                <div className="frow">
                  <span className="sig dash">{t("Por confirmar", "To confirm")}</span>
                  {f.poId && <CarrierForm po={deal.supplierPos.find((p) => p.id === f.poId)!} label={t("Confirmar manualmente", "Confirm manually")} />}
                  {f.activityId && (
                    <QA label={t("Confirmar manualmente", "Confirm manually")}>
                      <form action={confirmFact.bind(null, f.activityId)} className="qa-form">
                        <H />
                        <label>{t("¿Quién lo confirmó?", "Who confirmed it?")}<input name="source" /></label>
                        <button type="submit">{t("Confirmar", "Confirm")}</button>
                      </form>
                    </QA>
                  )}
                  {f.poId && (
                    <form action={setNextMove.bind(null, deal.id)}>
                      <H />
                      <input type="hidden" name="nextMove" value={t("Pedir ETA actualizada al transportista", "Ask the carrier for an updated ETA")} />
                      <input type="hidden" name="nextMoveDate" value={todayStr} />
                      <button type="submit" className="qa-btn">{t("Pedir actualización", "Ask for an update")}</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const Forward = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("ADELANTE", "FORWARD")}</b><span>{t("siguiente movimiento útil", "next useful movement")}</span></div>
      <div className="nm">
        {J.forward.mode === "wait" ? (
          <>
            <span className="k">{t("Esperando con control", "Waiting with control")}</span>
            <p className="what">{J.forward.what}</p>
            <div className="wwc">
              <span>{t("Revisar el", "Check on")}</span><span className={`until${J.forward.late ? " risk-t" : ""}`}>{dateMono(J.forward.date)}</span>
              <span className="trig">{J.forward.late ? t("La espera venció: aparece en Mi Día hasta que la resuelvas.", "The wait expired: it shows in Mi Día until you resolve it.") : t("Si no llega para esa fecha, aparece en Mi Día.", "If it hasn't arrived by then, it shows in Mi Día.")}</span>
            </div>
          </>
        ) : J.forward.mode === "move" ? (
          <>
            <span className="k">{t("Siguiente movimiento", "Next movement")} · {deal.owner.name}</span>
            <p className="what">{J.forward.what}</p>
            <p className={`why${J.forward.late ? " risk-t" : ""}`}>{J.forward.date ? i.date(J.forward.date) : t("sin fecha", "no date")}{J.forward.late ? t(" · se pasó la fecha", " · date has passed") : ""}</p>
          </>
        ) : J.suggestion ? (
          <>
            <span className="ai-note"><Spark /> {t("Nadie definió qué sigue · SOLU sugiere", "Nobody defined what's next · SOLU suggests")}</span>
            <p className="what">{J.suggestion.what}</p>
            <p className="why">{J.suggestion.why}</p>
            {editable && (
              <form action={setNextMove.bind(null, deal.id)} className="actions">
                <H />
                <input type="hidden" name="nextMove" value={J.suggestion.what} />
                <input type="hidden" name="nextMoveDate" value={todayStr} />
                <button type="submit" className="sm">{t("Usar como siguiente movimiento", "Use as next movement")}</button>
                {J.suggestion.tab !== tab && <Link className="btn secondary sm" href={`${self}?tab=${J.suggestion.tab}`}>{t(`Ir a ${tabLabel[J.suggestion.tab]}`, `Go to ${tabLabel[J.suggestion.tab]}`)}</Link>}
              </form>
            )}
          </>
        ) : (
          <p className="why">{J.lost ? t("Journey cerrado.", "Journey closed.") : t("Resultado logrado. No hace falta un movimiento.", "Result achieved. No movement needed.")}</p>
        )}
        {J.forward.mode !== "none" && J.suggestion && J.suggestion.what !== J.forward.what && (
          <span className="src"><Spark s={10} /> {t("SOLU también ve:", "SOLU also sees:")} {J.suggestion.what}</span>
        )}
        <ForwardActions />
      </div>
    </section>
  );

  const Timeline = () => {
    const T = J.timeline;
    const spaced = <X extends { left: number }>(arr: X[]) => {
      let last = -100;
      return [...arr].sort((a, b) => a.left - b.left).map((m) => { const show = m.left - last >= 10; if (show) last = m.left; return { ...m, show }; });
    };
    const side = (l: number) => (l > 88 ? " r" : l < 10 ? " l" : "");
    return (
      <section className="jblock">
        <div className="jbh"><b>{t("LÍNEA DE TIEMPO", "TIMELINE")}</b><span>{t("lo real, lo esperado y lo prometido, por separado", "real, expected and promised, kept apart")}</span></div>
        <div className="tl-wrap">
          <div className="tl">
            <span />
            <div className="lane days">
              {T.ticks.map((k) => <span key={k.left} className="day" style={{ left: `${k.left}%` }}>{k.label}</span>)}
              <span className="now-k" style={{ left: `${T.nowLeft}%` }}>{t("HOY", "TODAY")}</span>
            </div>
            <span className="lane-k">{t("Real", "Real")}</span>
            <div className="lane">
              {T.ticks.map((k) => <span key={k.left} className="grid-line" style={{ left: `${k.left}%` }} />)}
              <span className="now-line" style={{ left: `${T.nowLeft}%` }} />
              {spaced(T.real).map((m, k) => (
                <span key={k}>
                  <span className="mk actual" style={{ left: `${m.left}%` }} title={`${m.label} · ${i.day(m.date)}`} />
                  {m.show && <span className={`lbl${side(m.left)}`} style={{ left: `${m.left}%` }}><b>{m.label}</b>{i.day(m.date)}</span>}
                </span>
              ))}
              {T.real.length === 0 && <span className="lane-empty">{t("Aún sin hitos reales", "No real milestones yet")}</span>}
            </div>
            <span className="lane-k">{t("Esperado", "Expected")}</span>
            <div className="lane">
              {T.ticks.map((k) => <span key={k.left} className="grid-line" style={{ left: `${k.left}%` }} />)}
              <span className="now-line" style={{ left: `${T.nowLeft}%` }} />
              {spaced(T.expected).map((m, k) => (
                <span key={k}>
                  <span className={`mk ${m.late ? "late" : "expected"}${m.kind === "solu" ? " solu" : ""}`} style={{ left: `${m.left}%` }} title={`${m.label} · ${i.day(m.date)}`} />
                  {m.show && <span className={`lbl${side(m.left)}`} style={{ left: `${m.left}%` }}><b>{m.label}</b>{i.day(m.date)}</span>}
                </span>
              ))}
              {T.expected.length === 0 && <span className="lane-empty">{t("Sin fecha esperada todavía", "No expected date yet")}</span>}
            </div>
            <span className="lane-k">{t("Promesa", "Promise")}</span>
            <div className="lane">
              {T.ticks.map((k) => <span key={k.left} className="grid-line" style={{ left: `${k.left}%` }} />)}
              <span className="now-line" style={{ left: `${T.nowLeft}%` }} />
              {T.promise ? (
                <>
                  <span className="goal" style={{ left: `${T.promise.left}%` }} title={i.day(T.promise.date)} />
                  <span className={`lbl${side(T.promise.left)}`} style={{ left: `${T.promise.left}%` }}><b>{t("Prometido", "Promised")}</b>{i.day(T.promise.date)}</span>
                </>
              ) : <span className="lane-empty">{t("Sin fecha prometida", "No promised date")}</span>}
            </div>
          </div>
        </div>
        <div className="legend">
          <span><i className="lg actual" />{t("Pasó", "Happened")}</span>
          <span><i className="lg expected" />{t("Esperado", "Expected")}</span>
          <span><i className="lg late" />{t("Después de la promesa", "After the promise")}</span>
          <span><i className="lg lg-goal" />{t("Promesa", "Promise")}</span>
        </div>
      </section>
    );
  };

  const Risk = () =>
    !J.risk ? null : (
      <section className="jrisk" role="alert">
        <h3>{J.risk.title}</h3>
        <dl>
          <dt>{t("Por qué", "Why")}</dt><dd>{J.risk.why}</dd>
          <dt>{t("Impacto", "Impact")}</dt><dd>{J.risk.impact}</dd>
          <dt>{t("Qué falta", "Missing")}</dt><dd>{J.risk.missing}</dd>
          <dt>{t("Quién", "Who")}</dt><dd>{J.risk.who}</dd>
          <dt>{t("Opciones", "Options")}</dt><dd><ol>{J.risk.options.map((o) => <li key={o}>{o}</li>)}</ol></dd>
        </dl>
      </section>
    );

  const DesiredResult = () => (
    <section className="result">
      <div>
        <span className="k">{t("Resultado deseado", "Desired result")}</span>
        <h2>{deal.desiredResult ?? <span className="muted">{t("Aún sin definir", "Not defined yet")}</span>}</h2>
        <ul>
          {deal.needSpecs && <li>{deal.needSpecs}</li>}
          {deal.successMeasure && <li>{t("Éxito =", "Success =")} {deal.successMeasure}</li>}
          {deal.neededBy && <li>{t("Lo necesita para el", "Needed by")} {i.day(deal.neededBy)}</li>}
          {deal.impactIfNot && <li>{t("No resolverlo cuesta:", "Not solving it costs:")} {deal.impactIfNot}</li>}
        </ul>
        <div style={{ marginTop: 8 }}><NeedForm /></div>
      </div>
      <div className="eva">
        <span>{t("Esperado", "Expected")}</span><span className="v">{deal.neededBy ? i.day(deal.neededBy) : deal.promisedDate ? i.day(deal.promisedDate) : "—"}</span>
        <span>{t("Real", "Actual")}</span>
        <span className="v">{deal.resultAchievedAt ? t(`Logrado ${i.day(deal.resultAchievedAt)}`, `Achieved ${i.day(deal.resultAchievedAt)}`) : J.fullyDelivered ? t("Entregado, sin confirmar resultado", "Delivered, result not confirmed") : t("En camino", "In progress")}</span>
        {deal.resultNote && <span className="full">«{deal.resultNote}»</span>}
        {J.risk && <span className="gap">{J.risk.why}</span>}
      </div>
    </section>
  );

  // ---------- Tab bodies ----------
  const Summary = () => (
    <>
      <DesiredResult />
      <ThreeTruths />
      <div className="jtwo">
        <NowFacts />
        <Forward />
      </div>
      <Timeline />
      <Risk />
    </>
  );

  const Need = () => (
    <>
      <section className="jblock">
        <div className="jbh"><b>{t("QUÉ NECESITA, CÓMO Y CUÁNDO", "WHAT IS NEEDED, HOW AND WHEN")}</b></div>
        {editable ? <NeedForm inline /> : <DesiredResult />}
      </section>
      <PhaseLog phase="need" title={t("REGISTRO DE LA NECESIDAD", "NEED RECORD")} empty={t("Agrega lo que el cliente te cuenta: problema, contexto, quién decide, restricciones.", "Add what the customer tells you: problem, context, who decides, constraints.")} />
    </>
  );

  const Source = () => (
    <>
      <section className="jblock">
        <div className="jbh"><b>{t("CÓMO LO VAMOS A CONSEGUIR", "HOW WE WILL SOURCE IT")}</b></div>
        {editable ? (
          <form action={saveSourcing.bind(null, deal.id)} className="stack jform">
            <H />
            <label>{t("Fuente: marca, proveedor candidato, origen, alternativas", "Source: brand, candidate supplier, origin, alternatives")}<textarea name="sourcingNote" rows={3} defaultValue={deal.sourcingNote ?? ""} placeholder={t("Ej.: Grundfos vía distribuidor en Miami; alternativa ProMinent desde Alemania", "E.g.: Grundfos via Miami distributor; alternative ProMinent from Germany")} /></label>
            <div className="qa-row">
              <label>{t("Costo proveedor USD", "Supplier cost USD")}<input name="supplierCost" type="number" min="0" step="0.01" defaultValue={Number(deal.supplierCost)} /></label>
              <label>{t("Fletes USD", "Freight USD")}<input name="freightCost" type="number" min="0" step="0.01" defaultValue={Number(deal.freightCost)} /></label>
              <label>{t("Otros USD (aranceles, bancos)", "Other USD (duties, bank)")}<input name="otherCosts" type="number" min="0" step="0.01" defaultValue={Number(deal.otherCosts)} /></label>
            </div>
            <button type="submit">{t("Guardar fuente", "Save source")}</button>
          </form>
        ) : <p>{deal.sourcingNote ?? "—"}</p>}
        <p className="src" style={{ marginTop: 8 }}>{t("Esagra calculada", "Calculated esagra")}: USD {i.n(J.eg.value)} · {i.pct(J.eg.pct)}</p>
      </section>
      {deal.supplierPos.length > 0 && (
        <section className="jblock">
          <div className="jbh"><b>{t("PROVEEDORES EN ESTE JOURNEY", "SUPPLIERS ON THIS JOURNEY")}</b></div>
          <ul className="plain">{deal.supplierPos.map((p) => <li key={p.id}><b>{p.supplier.name}</b> · {p.code} · {p.currency} {i.n2(p.amount)}</li>)}</ul>
        </section>
      )}
      <PhaseLog phase="source" title={t("REGISTRO DE BÚSQUEDA", "SOURCING RECORD")} empty={t("Registra cotizaciones de proveedores, plazos que te dieron y por qué eliges uno.", "Record supplier quotes, lead times they gave, and why you choose one.")} />
    </>
  );

  const QuoteDocs = () => (
    <section className="jblock">
      <div className="jbh"><b>{t("COTIZACIONES", "QUOTES")}</b><span className="grow" />
        {editable && !quotes.some((x) => x.status === "DRAFT") && (
          <form action={createQuote.bind(null, deal.id)}><button type="submit" className="btn sm">{quotes.length ? t("Nueva cotización", "New quote") : t("Preparar cotización", "Prepare quote")}</button></form>
        )}
      </div>
      {quotes.length === 0 ? <p className="quiet-p">{t("Aún no hay cotización. Se prepara con solución, economía y promesa; los productos y costos del Journey se copian.", "No quote yet. It's prepared with solution, economics and promise; the Journey's products and costs are copied.")}</p> : (
        <ul className="plain">
          {quotes.map((x) => {
            const total = x.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0);
            const st = { DRAFT: ["dash", t("Borrador", "Draft")], PRESENTED: ["info", t("Presentada", "Presented")], SUPERSEDED: ["wait", t("Reemplazada", "Replaced")], ACCEPTED: ["ok", t("Aceptada", "Accepted")], DECLINED: ["wait", t("No aceptada", "Declined")] }[x.status];
            return (
              <li key={x.id} className="qa-row">
                <Link href={`/cotizaciones/${x.id}`} className="val">Nº {x.number}{x.rev ? ` Rev. ${x.rev}` : ""}</Link>
                <span className={`sig ${st[0]}`}>{st[1]}</span>
                <span className="mono small">USD {i.n2(total)}</span>
                <span className="grow" />
                <a className="small" href={`/documentos/cotizacion/${x.id}`} target="_blank" rel="noopener">PDF</a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  const Quote = () => (
    <>
      <QuoteDocs />
      <section className="jblock">
        <div className="jbh"><b>{t("PRODUCTOS", "PRODUCTS")}</b><span className="grow" /><span className="src">{t("Entregado", "Delivered")} {J.delivered} / {J.ordered}</span></div>
        {deal.items.length === 0 ? <p className="quiet-p">{t("Sin productos todavía.", "No products yet.")}</p> : (
          <div className="tscroll">
            <table>
              <thead><tr><th>{t("Cant.", "Qty")}</th><th>{t("Código", "Code")}</th><th>{t("Descripción", "Description")}</th><th className="n">{t("Precio unit.", "Unit price")}</th><th className="n">Total</th><th /></tr></thead>
              <tbody>
                {deal.items.map((it) => {
                  const d = it.deliveryLines.reduce((s, l) => s + l.qty, 0);
                  return (
                    <tr key={it.id}>
                      <td className="val">{it.qty}</td><td className="mono small">{it.code ?? "—"}</td><td>{it.description}</td>
                      <td className="n val">{i.n2(it.unitPrice)}</td><td className="n val">{i.n2(Number(it.unitPrice) * it.qty)}</td>
                      <td>{editable && d === 0 && <form action={removeItem.bind(null, deal.id, it.id)}><button className="link small" type="submit">{t("Quitar", "Remove")}</button></form>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <details style={{ marginTop: 10 }}>
            <summary>{t("Agregar producto", "Add product")}</summary>
            <form action={addItem.bind(null, deal.id)} className="inline">
              <label>{t("Cant.", "Qty")}<input name="qty" type="number" min="1" defaultValue="1" required style={{ width: 70 }} /></label>
              <label>{t("Código", "Code")}<input name="code" style={{ width: 120 }} /></label>
              <label style={{ flex: 1 }}>{t("Descripción", "Description")}<input name="description" required /></label>
              <label>{t("Precio unit. USD", "Unit price USD")}<input name="unitPrice" type="number" min="0" step="0.01" required style={{ width: 120 }} /></label>
              <button type="submit">{t("Agregar", "Add")}</button>
            </form>
          </details>
        )}
      </section>
      <section className="jblock">
        <div className="jbh"><b>{t("CONDICIONES", "TERMS")}</b><span className="grow" />{deal.quoteSentAt ? <span className="sig ok">{t(`Enviada ${i.day(deal.quoteSentAt)}`, `Sent ${i.day(deal.quoteSentAt)}`)}</span> : <span className="sig wait">{t("No enviada", "Not sent")}</span>}</div>
        {editable ? (
          <form action={saveQuote.bind(null, deal.id)} className="stack jform">
            <H />
            <div className="qa-row">
              <label>{t("Venta USD", "Sale USD")}<input name="amount" type="number" min="0" step="0.01" defaultValue={Number(deal.amount)} /></label>
              <label>Incoterm<input name="incoterm" defaultValue={deal.incoterm ?? ""} placeholder="DAP, FCA, EXW…" /></label>
              <label>{t("Forma de pago", "Payment terms")}<input name="paymentTerms" defaultValue={deal.paymentTerms ?? ""} placeholder={t("Ej.: 30 días fecha factura", "E.g.: net 30")} /></label>
            </div>
            <div className="qa-row">
              <label>{t("Oferta vigente hasta", "Offer valid until")}<input name="offerValidUntil" type="date" defaultValue={dayInput(deal.offerValidUntil)} /></label>
              <label>{t("Cierre esperado", "Expected close")}<input name="closeDate" type="date" defaultValue={dayInput(deal.closeDate)} /></label>
            </div>
            <button type="submit">{t("Guardar condiciones", "Save terms")}</button>
          </form>
        ) : <p>{deal.incoterm ?? "—"} · {deal.paymentTerms ?? "—"}</p>}
        <p className="src" style={{ marginTop: 8 }}>{t("Esagra calculada", "Calculated esagra")}: USD {i.n(J.eg.value)} · {i.pct(J.eg.pct)} · {t("venta − proveedor − fletes − otros", "sale − supplier − freight − other")}</p>
        {editable && !deal.quoteSentAt && (
          <form action={markQuoteSent.bind(null, deal.id)} className="qa-row" style={{ marginTop: 10 }}>
            <H />
            <input name="sentOn" type="date" defaultValue={todayStr} aria-label={t("Fecha de envío", "Sent on")} />
            <input name="source" placeholder={t("Cómo se envió (opcional)", "How it was sent (optional)")} />
            <button type="submit" className="secondary">{t("Marcar como enviada", "Mark as sent")}</button>
          </form>
        )}
      </section>
      <PhaseLog phase="quote" title={t("REGISTRO DE LA COTIZACIÓN", "QUOTE RECORD")} empty={t("Registra objeciones, descuentos pedidos y versiones enviadas.", "Record objections, discounts asked for, and versions sent.")} />
    </>
  );

  const Execute = () => (
    <>
      <ThreeTruths />
      {editable && !deal.customerPo && !J.lost && (
        <section className="jblock">
          <div className="jbh"><b>{t("OC DEL CLIENTE", "CUSTOMER PO")}</b></div>
          <form action={acceptCustomerPo.bind(null, deal.id)} className="qa-row">
            <label>{t("Número de OC", "PO number")}<input name="customerPo" required /></label>
            <label>{t("Aceptada el", "Accepted on")}<input name="poAcceptedAt" type="date" defaultValue={todayStr} /></label>
            <button type="submit">{t("Registrar OC", "Record PO")}</button>
          </form>
        </section>
      )}
      <section className="jblock">
        <div className="jbh"><b>{t("COMPRA Y ENVÍO", "PURCHASE AND SHIPPING")}</b></div>
        {deal.supplierPos.length === 0 ? <p className="quiet-p">{t("Aún no hay Supplier PO.", "No supplier PO yet.")}</p> : (
          <div className="pos">
            {deal.supplierPos.map((p) => {
              const st = p.receivedAt ? { c: "ok", x: t(`En bodega desde ${i.day(p.receivedAt)}`, `In warehouse since ${i.day(p.receivedAt)}`) }
                : p.shippedAt ? { c: "wait", x: t(`En tránsito desde ${i.day(p.shippedAt)}`, `In transit since ${i.day(p.shippedAt)}`) }
                : p.confirmedAt ? { c: "info", x: t("Confirmada por el proveedor", "Confirmed by supplier") }
                : { c: "attn", x: t("Sin confirmar", "Not confirmed") };
              return (
                <div key={p.id} className="po">
                  <div className="po-h"><Link href={`/compras/${p.id}`} className="val">{p.code}</Link><span>{p.supplier.name} · {p.currency} {i.n2(p.amount)}</span><span className="grow" />{p.releasedAt ? <span className={`sig ${st.c}`}>{st.x}</span> : <span className="sig dash">{t("Borrador · sin liberar", "Draft · not released")}</span>}</div>
                  <dl className="po-d">
                    <dt>{t("ETA proveedor", "Supplier ETA")}</dt><dd>{dateMono(p.eta)}</dd>
                    <dt>{t("ETA transportista", "Carrier ETA")}</dt><dd>{dateMono(p.carrierEta)}{p.carrierName ? ` · ${p.carrierName}` : ""}{p.tracking ? ` · ${p.tracking}` : ""}</dd>
                  </dl>
                  {editable && !p.receivedAt && (
                    <div className="qa-bar">
                      <form action={markSupplierPo.bind(null, p.id, !p.confirmedAt ? "confirmedAt" : !p.shippedAt ? "shippedAt" : "receivedAt")} className="qa-row">
                        {p.confirmedAt && !p.shippedAt && <input name="eta" type="date" aria-label="ETA" title="ETA" />}
                        <button className="qa-btn" type="submit">{!p.confirmedAt ? t("✓ El proveedor confirmó", "✓ Supplier confirmed") : !p.shippedAt ? t("✓ Despachó", "✓ Shipped") : t("✓ Llegó a bodega", "✓ Arrived")}</button>
                      </form>
                      <CarrierForm po={p} label={p.carrierEta ? t("Actualizar ETA transportista", "Update carrier ETA") : t("Registrar ETA transportista", "Record carrier ETA")} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {editable && (
          <div className="qa-bar" style={{ marginTop: 10 }}>
            <form action={prepareSpo.bind(null, deal.id)}><button type="submit" className="btn sm">{t("Preparar Supplier PO desde la cotización", "Prepare Supplier PO from the quote")}</button></form>
            {sp.ok === "sin-proveedor" && <span className="attn-t small">{t("La base de suministro de la cotización no coincide con ningún proveedor registrado.", "The quote's supply basis doesn't match any registered supplier.")}</span>}
          </div>
        )}
        {editable && (
          <details style={{ marginTop: 10 }}>
            <summary className="small">{t("Crear manualmente (sin cotización)", "Create manually (no quote)")}</summary>
            {suppliers.length === 0 ? <p className="small">{t("Primero crea el proveedor en ", "First create the supplier in ")}<Link href="/suppliers">{t("Proveedores", "Suppliers")}</Link>.</p> : (
              <form action={createSupplierPo.bind(null, deal.id)} className="inline">
                <label>{t("Proveedor", "Supplier")}<select name="supplierId" required defaultValue=""><option value="" disabled>{t("Elegir…", "Choose…")}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label>{t("Valor", "Amount")}<input name="amount" type="number" min="0" step="0.01" required style={{ width: 120 }} /></label>
                <label>{t("Moneda", "Currency")}<input name="currency" defaultValue="USD" style={{ width: 70 }} /></label>
                <label>{t("ETA proveedor", "Supplier ETA")}<input name="eta" type="date" /></label>
                <button type="submit">{t("Crear", "Create")}</button>
              </form>
            )}
          </details>
        )}
      </section>
      <section className="jblock">
        <div className="jbh"><b>{t("ENTREGAS AL CLIENTE", "DELIVERIES TO THE CUSTOMER")}</b><span className="grow" />
          {editable && J.won && !J.fullyDelivered && <Link className="btn secondary sm" href={`/operaciones/remisiones/nueva?deal=${deal.id}`}>{t("Nueva remisión", "New delivery note")}</Link>}
        </div>
        {deal.deliveries.length === 0 ? <p className="quiet-p">{J.won ? t("Aún no hay entregas.", "No deliveries yet.") : t("Las entregas se registran cuando la OC del cliente está aceptada.", "Deliveries are recorded once the customer PO is accepted.")}</p> : (
          <ul className="plain">
            {deal.deliveries.map((d) => (
              <li key={d.id}><Link href={`/operaciones/remisiones/${d.id}`} className="val">{d.code}</Link> · {i.day(d.deliveredAt)} · {d.lines.reduce((s, l) => s + l.qty, 0)} {t("unid.", "units")} · {d.podReceived ? t("con prueba de entrega", "with proof of delivery") : <span className="attn-t">{t("sin prueba de entrega", "no proof of delivery")}</span>}</li>
            ))}
          </ul>
        )}
      </section>
      <PhaseLog phase="execute" title={t("REGISTRO DE EJECUCIÓN", "EXECUTION RECORD")} empty={t("Registra novedades de despacho, aduana, transporte e instalación.", "Record shipping, customs, transport and installation updates.")} />
    </>
  );

  const Finance = () => (
    <>
      <section className="jblock">
        <div className="jbh"><b>{t("COBRO AL CLIENTE", "CUSTOMER COLLECTION")}</b><span className="grow" /><span className="src">{t("Facturado", "Invoiced")} USD {i.n(J.invoiced)} / {i.n(deal.amount)} · {t("conciliado", "reconciled")} {i.n(J.reconciled)}</span></div>
        {J.cash.length === 0 ? <p className="quiet-p">{J.uninvoicedDeliveries.length ? t("Hay entregas sin facturar: ", "There are uninvoiced deliveries: ") : t("Aún no hay facturas.", "No invoices yet.")}{J.uninvoicedDeliveries.length > 0 && <Link href="/operaciones/por-facturar">{t("ir a facturar", "go invoice")}</Link>}</p> : (
          <div className="pos">
            {J.cash.map((c) => {
              const prom = c.inv.promises[0];
              const late = c.balance > 0.005 && c.inv.dueAt < J.now;
              return (
                <div key={c.inv.id} className="po">
                  <div className="po-h"><b>{c.inv.number}</b><span>USD {i.n2(c.amount)} · {t("vence", "due")} {i.day(c.inv.dueAt)}</span>{deal.customerPo && <a className="small" href={`/documentos/factura/${c.inv.id}`} target="_blank" rel="noopener">PDF</a>}<span className="grow" /><span className={`sig ${c.balance <= 0.005 ? "ok" : late ? "risk" : "wait"}`}>{c.balance <= 0.005 ? t("Cobrada", "Collected") : t(`Saldo USD ${i.n(c.balance)}`, `Balance USD ${i.n(c.balance)}`)}</span></div>
                  {prom && <p className="src">{t(`${prom.promisedBy} prometió pagar el ${i.day(prom.promisedFor)} · ${prom.source}`, `${prom.promisedBy} promised to pay on ${i.day(prom.promisedFor)} · ${prom.source}`)}</p>}
                  {c.pendingReconcile > 0 && <p className="src">{t(`USD ${i.n(c.pendingReconcile)} recibidos sin conciliar`, `USD ${i.n(c.pendingReconcile)} received, not reconciled`)}</p>}
                  {editable && c.balance > 0.005 && (
                    <div className="qa-bar">
                      <QA label={t("Registrar promesa de pago", "Record payment promise")} wide>
                        <form action={newPromise.bind(null, c.inv.id)} className="qa-form">
                          <H />
                          <label>{t("Fecha de pago prometida", "Promised payment date")}<input name="promisedFor" type="date" defaultValue={tomorrowStr} required /></label>
                          <label>{t("Quién lo promete", "Who promises")}<input name="promisedBy" defaultValue={prom?.promisedBy ?? (deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "")} required /></label>
                          <label>{t("Fuente", "Source")}<input name="source" required placeholder={t("Ej.: llamada de hoy", "E.g.: today's call")} /></label>
                          <button type="submit">{t("Guardar promesa", "Save promise")}</button>
                        </form>
                      </QA>
                      <Link className="qa-btn" href="/administracion/cobrar">{t("Ver en cuentas por cobrar", "See in receivables")}</Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="jblock">
        <div className="jbh"><b>{t("PAGOS A PROVEEDORES", "SUPPLIER PAYMENTS")}</b></div>
        {deal.supplierPos.length === 0 ? <p className="quiet-p">{t("Sin Supplier PO todavía.", "No supplier PO yet.")}</p> : (
          <div className="pos">
            {deal.supplierPos.map((p) => (
              <div key={p.id} className="po">
                <div className="po-h"><Link href={`/compras/${p.id}`} className="val">{p.code}</Link><span>{p.supplier.name} · {p.currency} {i.n2(p.amount)}</span><span className="grow" /><Link className="qa-btn" href={`/compras/${p.id}`}>{t("Plan de pago", "Payment plan")}</Link></div>
                {p.payments.length === 0 ? <p className="src">{t("Sin solicitudes de pago. Se piden por hito desde la Supplier PO.", "No payment requests. They're requested per milestone from the Supplier PO.")}</p> : (
                  <ul className="plain">
                    {p.payments.map((pay) => {
                      const L = paymentStateLabel(i, paymentState({ ...pay, discrepancies: bankDiscrepancies(p.supplier, pay).length, executions: pay.executions }));
                      return <li key={pay.id}><span className="mono">{pay.currency} {i.n2(pay.amount)}</span> · <Link href={`/administracion/pagos-proveedores/${pay.id}`} className={`sig ${L.cls}`}>{L.text}</Link></li>;
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="src" style={{ marginTop: 8 }}>{t("Esagra calculada", "Calculated esagra")}: USD {i.n(J.eg.value)} · {i.pct(J.eg.pct)}</p>
      </section>
      <PhaseLog phase="finance" title={t("REGISTRO FINANCIERO", "FINANCE RECORD")} empty={t("Registra acuerdos de pago, retenciones y novedades de cobro.", "Record payment agreements, withholdings and collection updates.")} />
    </>
  );

  const BizFile = () => (
    <>
      <section className="jblock">
        <div className="jbh"><b>{t("EXPEDIENTE", "BUSINESS FILE")}</b></div>
        <dl className="filedl">
          <dt>Journey</dt><dd className="mono">{deal.code ?? "—"}</dd>
          <dt>{t("Cliente", "Customer")}</dt><dd><Link href={`/accounts/${deal.account.id}`}>{deal.account.name}</Link></dd>
          <dt>{t("Contacto", "Contact")}</dt><dd>{deal.contact ? `${deal.contact.firstName} ${deal.contact.lastName}` : "—"}</dd>
          <dt>{t("Responsable", "Owner")}</dt><dd>{deal.owner.name}</dd>
          <dt>{t("Etapa", "Stage")}</dt><dd>{stageLabel(i, deal.stage)}</dd>
          <dt>{t("OC del cliente", "Customer PO")}</dt><dd className="mono">{deal.customerPo ?? "—"} {deal.poAcceptedAt && `· ${i.day(deal.poAcceptedAt)}`}</dd>
          <dt>{t("Venta", "Sale")}</dt><dd className="mono">USD {i.n2(deal.amount)}</dd>
          <dt>Incoterm · {t("pago", "terms")}</dt><dd>{deal.incoterm ?? "—"} · {deal.paymentTerms ?? "—"}</dd>
          <dt>{t("Creado", "Created")}</dt><dd>{i.date(deal.createdAt)}</dd>
        </dl>
        {editable && (
          <details style={{ marginTop: 10 }}>
            <summary>{t("Editar datos administrativos", "Edit administrative data")}</summary>
            <form action={saveFile.bind(null, deal.id)} className="stack jform">
              <H />
              <label>{t("Título interno", "Internal title")}<input name="title" defaultValue={deal.title} required /></label>
              <label>{t("Contacto", "Contact")}<select name="contactId" defaultValue={deal.contactId ?? ""}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></label>
              <div className="qa-row">
                <label>{t("OC del cliente", "Customer PO")}<input name="customerPo" defaultValue={deal.customerPo ?? ""} /></label>
                <label>{t("Aceptada el", "Accepted on")}<input name="poAcceptedAt" type="date" defaultValue={dayInput(deal.poAcceptedAt)} /></label>
              </div>
              <button type="submit">{t("Guardar", "Save")}</button>
            </form>
          </details>
        )}
      </section>
      <section className="jblock">
        <div className="jbh"><b>{t("DOCUMENTOS", "DOCUMENTS")}</b></div>
        <Docs all />
      </section>
      <section className="jblock">
        <div className="jbh"><b>{t("PENDIENTES", "TO-DOS")}</b></div>
        {deal.tasks.length === 0 ? <p className="quiet-p">{t("Nada pendiente.", "Nothing pending.")}</p> : <ul className="plain">{deal.tasks.map((tk) => <li key={tk.id}>{tk.title} <span className="src">{tk.assignee.name} · {i.dateShort(tk.dueDate)}</span></li>)}</ul>}
      </section>
      <section className="jblock">
        <div className="jbh"><b>{t("HISTORIA COMPLETA", "FULL HISTORY")}</b><span>{deal.activities.length}</span></div>
        <ul className="timeline">
          {deal.activities.map((a) => <li key={a.id}><b>{a.subject}</b> {a.body && <span className="small">{a.body}</span>}<div className="src">{a.user.name} · {i.date(a.occurredAt)}{a.source ? ` · ${a.source}` : ""}</div></li>)}
          {deal.activities.length === 0 && <li className="small muted">{t("Sin actividad todavía.", "No activity yet.")}</li>}
        </ul>
      </section>
      {editable && deal.invoices.length === 0 && (
        <details>
          <summary className="small">{t("Eliminar este Journey", "Delete this Journey")}</summary>
          <form action={deleteDeal.bind(null, deal.id)}><button className="danger sm" type="submit">{t("Eliminar definitivamente", "Delete permanently")}</button></form>
        </details>
      )}
    </>
  );

  const Result = () => (
    <>
      <DesiredResult />
      <section className="jblock">
        <div className="jbh"><b>{t("¿EL CLIENTE LOGRÓ SU RESULTADO?", "DID THE CUSTOMER ACHIEVE THE RESULT?")}</b></div>
        {editable ? (
          <form action={saveResult.bind(null, deal.id)} className="stack jform">
            <H />
            <label>{t("Qué logró, en palabras del cliente", "What they achieved, in the customer's words")}<textarea name="resultNote" rows={3} defaultValue={deal.resultNote ?? ""} placeholder={t("Ej.: «la línea 2 lleva 30 días sin paradas»", "E.g.: “line 2 has run 30 days without stops”")} /></label>
            <label>{t("Fuente", "Source")}<input name="source" placeholder={t("Ej.: visita a planta con Carlos", "E.g.: site visit with Carlos")} /></label>
            <label className="chk"><input type="checkbox" name="achieved" value="1" defaultChecked={!!deal.resultAchievedAt} /> {t("El cliente confirmó que logró su resultado", "The customer confirmed they achieved the result")}</label>
            <span className="src">{t("Entregar no es resolver: márcalo solo cuando el cliente lo confirme.", "Delivering is not solving: tick it only when the customer confirms.")}</span>
            <button type="submit">{t("Guardar resultado", "Save result")}</button>
          </form>
        ) : <p>{deal.resultNote ?? "—"}</p>}
      </section>
      <PhaseLog phase="result" title={t("REGISTRO DEL RESULTADO", "RESULT RECORD")} empty={t("Registra lo que el cliente dice después de la entrega.", "Record what the customer says after delivery.")} />
    </>
  );

  // ---------- Rail ----------
  const Docs = ({ all }: { all?: boolean }) => {
    const list = all ? J.docs : J.docs.slice(-5);
    return list.length === 0 ? <p className="quiet-p">{t("Aún no hay documentos.", "No documents yet.")}</p> : (
      <div className="ev">
        {list.map((d, k) => {
          const inner = (<><span className="ic">{d.kind}</span><span><b>{d.title}</b><span className="src">{d.sub}</span></span></>);
          return d.href ? <Link key={k} href={d.href} className="doc">{inner}</Link> : <div key={k} className="doc">{inner}</div>;
        })}
      </div>
    );
  };

  const ChangesList = ({ max = 6 }: { max?: number }) =>
    J.changes.length === 0 ? <p className="quiet-p">{t("Nada cambió desde tu última visita.", "Nothing changed since your last visit.")}</p> : (
      <div className="chg">
        {J.changes.slice(0, max).map((c, k) => (
          <div key={k} className="chg-i"><span className="t">{i.day(c.at)}</span><span><b>{c.what}</b>{c.cons && <span className="cons">{c.cons}</span>}</span></div>
        ))}
        {J.changes.length > max && <p className="src">{t(`y ${J.changes.length - max} más`, `and ${J.changes.length - max} more`)}</p>}
      </div>
    );

  const Body = { resumen: Summary, need: Need, source: Source, quote: Quote, execute: Execute, finance: Finance, file: BizFile, result: Result }[tab];

  return (
    <div className="jw">
      <Popovers />
      <OutlookNote code={sp.cal} t={t} />
      {sp.ok && okMsg[sp.ok] && <div className={`note${sp.ok.startsWith("sin-") ? " attn" : " okn"}`} role="status">{okMsg[sp.ok]}</div>}

      <header className="jh">
        <div className="jh-top">
          <span className="crumb"><Link href="/deals">{t("COMERCIAL · JOURNEYS", "COMMERCIAL · JOURNEYS")}</Link></span>
          {deal.code && <span className="jid">{deal.code}</span>}
          <span className="grow" />
          <div className="jh-act">
            <QA label={<>{t("¿Qué cambió?", "What changed?")}{J.changes.length > 0 && <span className="badge">{J.changes.length}</span>}</>} wide right>
              <b className="pop-t">{t("Desde tu última visita", "Since your last visit")} · {i.day(J.since)}</b>
              <ChangesList max={8} />
              {J.changes.length > 0 && (
                <form action={markJourneySeen.bind(null, deal.id)} style={{ marginTop: 8 }}>
                  <button type="submit" className="secondary sm">{t("Marcar como visto", "Mark as seen")}</button>
                </form>
              )}
            </QA>
            <QA label={t("Ponerme al día", "Catch me up")} wide right>
              <b className="pop-t">{t("En 20 segundos", "In 20 seconds")}</b>
              <div className="story">{J.story.map((s, k) => <p key={k}>{s}</p>)}</div>
              <span className="src">{t("Armado con los datos de este Journey.", "Built from this Journey's data.")}</span>
            </QA>
            <QA label={<><Spark /> {t("Pregúntale a SOLU", "Ask SOLU")}</>} wide right cls="ask">
              <b className="pop-t"><Spark /> {t("Sobre este Journey", "About this Journey")}</b>
              <div className="answers">
                {J.answers.map((a) => (
                  <details key={a.q} className="ans">
                    <summary>{a.q}</summary>
                    <p>{a.a}</p>
                  </details>
                ))}
              </div>
              <span className="src">{t("Respuestas calculadas con los datos de este Journey. Las preguntas libres llegarán cuando conectemos la IA.", "Answers calculated from this Journey's data. Free-form questions will come when AI is connected.")}</span>
            </QA>
          </div>
        </div>
        <div className="jh-title">
          <h1>{deal.account.name}</h1>
          <span className={`sig ${toneCls(J.signal.tone)}`}>{J.signal.label}</span>
          <span className="sig-why">{J.signal.why}</span>
        </div>
        <p className="jh-sub">{deal.title}{deal.contact && <> · {deal.contact.firstName} {deal.contact.lastName}</>} · {deal.owner.name}</p>
        <div className="dr">
          <span className="k">{t("Resultado deseado", "Desired result")}</span>
          {deal.desiredResult ? <span>{deal.desiredResult}</span> : <span className="muted">{t("Aún sin definir", "Not defined yet")} <NeedForm /></span>}
        </div>
        <div className="strip">
          <div>
            <span className="k">{t("Ahora", "Now")}</span>
            {J.nowFacts.slice(0, 2).map((f) => <p key={f.key} className={f.uncertain ? "unc" : ""}>{f.text}<span className="src"> · {f.when ? i.day(f.when) : "—"} · {f.src}</span></p>)}
            {J.nowFacts.length === 0 && <p className="muted">{t("Sin hechos todavía", "No facts yet")}</p>}
          </div>
          <div>
            <span className="k">{t("Adelante · siguiente movimiento útil", "Forward · next useful movement")}</span>
            {J.forward.mode === "wait" ? (
              <p><b>{t("Esperando:", "Waiting:")} {J.forward.what}</b><span className={`src${J.forward.late ? " risk-t" : ""}`}> · {t("revisar", "check")} {i.day(J.forward.date)}</span></p>
            ) : J.forward.mode === "move" ? (
              <p><b>{J.forward.what}</b><span className={`src${J.forward.late ? " risk-t" : ""}`}> · {J.forward.date ? i.day(J.forward.date) : t("sin fecha", "no date")}</span></p>
            ) : J.suggestion ? (
              <p><span className="infer"><Spark s={11} /></span> <b>{J.suggestion.what}</b><span className="src"> · {t("sugerido por SOLU", "suggested by SOLU")}</span></p>
            ) : <p className="muted">—</p>}
          </div>
          <div className="promise">
            <span className="k">{t("Promesa al cliente", "Customer promise")}</span>
            <p><b>{dateMono(J.promise.date)}</b> {J.promise.text && <span>{J.promise.text}</span>}</p>
            <span className={`sig ${toneCls(J.promiseState.tone)}`}>{J.promiseState.text}</span>
          </div>
        </div>
        <nav className="jtabs" aria-label={t("Fases del Journey", "Journey phases")}>
          {shown.map((k) => <Link key={k} href={k === "resumen" ? self : `${self}?tab=${k}`} className={`jtab${k === tab ? " on" : ""}`} aria-current={k === tab ? "page" : undefined}>{tabLabel[k]}</Link>)}
          {later.length > 0 && (
            <span className="later">{t("Más adelante:", "Later:")} {later.map((k, n) => <span key={k}>{n > 0 && " · "}<Link href={`${self}?tab=${k}`}>{tabLabel[k]}</Link></span>)}</span>
          )}
        </nav>
      </header>

      <div className="jbody">
        <main className="jmain"><Body /></main>
        <aside className="jrail">
          <section id="changed">
            <div className="jbh"><b>{t("QUÉ CAMBIÓ", "WHAT CHANGED")}</b><span>{t("desde", "since")} {i.day(J.since)}</span></div>
            <ChangesList />
          </section>
          <section>
            <div className="jbh"><b>{t("EVIDENCIA", "EVIDENCE")}</b><span className="grow" />{J.docs.length > 5 && <Link href={`${self}?tab=file`} className="small">{t("Ver todo", "See all")}</Link>}</div>
            <Docs />
          </section>
          <section>
            <div className="jbh"><b>{t("CONVERSACIÓN", "CONVERSATION")}</b></div>
            {J.conversation.length === 0 ? <p className="quiet-p">{t("Sin llamadas, reuniones ni correos registrados.", "No calls, meetings or emails recorded.")}</p> : J.conversation.map((a) => (
              <div key={a.id} className="msg">
                <div className="meta">{typeLabel(i, a.type)} · {a.user.name} · {i.day(a.occurredAt)}</div>
                {a.subject}{a.body && a.body !== "✓" && <span className="muted"> — {a.body}</span>}
              </div>
            ))}
            {editable && (
              <div style={{ marginTop: 8 }}>
                <QA label={t("+ Registrar conversación", "+ Log conversation")} right>
                  <form action={logHappened.bind(null, deal.id)} className="qa-form">
                    <H />
                    <select name="type" defaultValue="CALL" aria-label={t("Tipo", "Type")}>
                      <option value="CALL">{t("Llamada", "Call")}</option>
                      <option value="EMAIL">{t("Correo", "Email")}</option>
                      <option value="MEETING">{t("Reunión", "Meeting")}</option>
                    </select>
                    <input name="subject" required placeholder={t("Qué se dijo, en una línea", "What was said, in one line")} />
                    <button type="submit">{t("Registrar", "Log")}</button>
                  </form>
                </QA>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

