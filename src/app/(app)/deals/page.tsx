import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, dayInput, esagra, today } from "@/lib/domain";
import { STAGES, stageLabel } from "@/lib/labels";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Split } from "@/components/Viz";
import { PathLegend, pathWords } from "@/components/JourneyPath";
import { cardAsk } from "@/lib/journey";
import { createNeed, moveDealStage } from "./actions";
import { NewNeedForm } from "@/components/NewNeedForm";
import { addWorkingDays } from "@/lib/holidays";
import { aiConfigured } from "@/lib/ai";
import { boxKey, mailAsCase, readOne } from "@/lib/mailbox";
import { canManageAll } from "@/lib/permissions";

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ mine?: string; err?: string; conv?: string; mail?: string; box?: string; f?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { mine, err, conv, mail, box, f } = await searchParams;
  // "Crear Necesidad con IA" from a conversation in MI DÍA → Comunicación: its text becomes the case.
  const th = conv ? await db.commThread.findUnique({ where: { id: conv.slice(0, 40) }, select: { id: true, subject: true, partyName: true, partyAddr: true, accountId: true, contactId: true, account: { select: { ownerId: true, name: true } }, messages: { orderBy: { sentAt: "asc" }, take: 30, select: { direction: true, authorName: true, body: true, sentAt: true } } } }) : null;
  const aiSeed = th && (!th.account || canManageAll(user) || th.account.ownerId === user.id) ? {
    threadId: th.id, accountId: th.accountId, contactId: th.contactId, from: th.partyName ?? th.account?.name ?? th.partyAddr ?? "—",
    text: [th.account ? `Cliente: ${th.account.name}` : null, th.partyName ? `Persona: ${th.partyName}` : null, th.subject ? `Asunto: ${th.subject}` : null, "",
      ...th.messages.map((m) => `[${m.sentAt.toISOString().slice(0, 10)} · ${m.direction === "IN" ? "el cliente" : "nosotros"} · ${m.authorName}]\n${m.body.trim()}`)].filter((x) => x !== null).join("\n").slice(0, 7800),
  } : null;
  const now = today();
  // "Crear Necesidad con IA" from one email picked in MI DÍA → Comunicación → Correos del buzón (own or company mailbox).
  let mailSeed: { threadId: string; text: string; from: string; accountId: string | null; contactId: string | null } | null = null;
  let mailErr = false;
  if (mail && !conv) {
    const folder = f === "in" ? "in" as const : "out" as const;
    try {
      const m = await readOne(boxKey(box), folder, mail.slice(0, 400), user);
      mailSeed = { threadId: "", text: mailAsCase(m, folder), from: (folder === "out" ? m.to : m.from) || m.subject, accountId: null, contactId: null };
    } catch { mailErr = true; }
  }

  // The board shows working Journeys: closed ones and losses older than 90 days stay in history
  // (Customer 360, Insights), so this page doesn't grow forever.
  const scope = mine ? { ownerId: user.id } : {};
  const [deals, accounts, closedCount, contacts, parts, pastMachines, assets] = await Promise.all([
    db.deal.findMany({
      where: { ...scope, internal: false, closedAt: null, OR: [{ stage: { not: "LOST" } }, { updatedAt: { gte: addDays(now, -90) } }] },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, code: true, title: true, stage: true, amount: true, supplierCost: true, freightCost: true, otherCosts: true, nextMove: true, nextMoveDate: true, waitingFor: true, waitingUntil: true, promisedDate: true, resultAchievedAt: true, ownerId: true, _count: { select: { deliveries: true } },
        account: { select: { id: true, name: true } }, owner: { select: { name: true } },
      },
    }),
    db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, select: { id: true, name: true, address: true, city: true, region: true, postalCode: true, country: true, shipSame: true, shipAddress: true, shipCity: true, shipRegion: true, shipPostalCode: true, shipCountry: true } }),
    db.deal.count({ where: { ...scope, closedAt: { not: null } } }),
    // For the new-request form: contacts per customer, and what is already registered so nobody types it twice.
    db.contact.findMany({ where: { account: { internal: false } }, orderBy: { firstName: "asc" }, select: { id: true, accountId: true, firstName: true, lastName: true, email: true } }),
    db.part.findMany({ where: { mergedIntoId: null }, orderBy: { updatedAt: "desc" }, take: 600, select: { mpn: true, name: true } }),
    db.deal.findMany({ where: { machine: { not: null }, internal: false }, distinct: ["accountId", "machine"], select: { accountId: true, machine: true }, take: 800 }),
    db.installedAsset.findMany({ select: { name: true, manufacturer: true, model: true, plant: { select: { accountId: true } } }, take: 800 }),
  ]);
  const machines = [
    ...pastMachines.map((m) => ({ accountId: m.accountId, name: m.machine! })),
    ...assets.map((x) => ({ accountId: x.plant.accountId, name: [x.name, x.manufacturer, x.model].filter(Boolean).join(" · ") })),
  ];

  const open = deals.filter((d) => !["WON", "LOST"].includes(d.stage));
  const noMove = open.filter((d) => !d.nextMove && !d.waitingFor);
  const W = pathWords(i.es);
  const mineNow = deals.filter((d) => cardAsk({ ...d, deliveries: d._count.deliveries }, now) === "now");

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Comercial", "Commercial")}</div>
          <h1>{t("Necesidades y negocios", "Needs & deals")}</h1>
          <p>{t("Cada Necesidad une lo que el cliente necesita con la compra, la entrega, la factura, el cobro y el resultado.", "Each Need links what the customer needs to purchasing, delivery, invoice, cash and result.")}</p>
        </div>
        <div className="grow" />
        <div className="row small">
          <Link href="/deals">{t("Todos", "All")}</Link> · <Link href="/deals?mine=1">{t("Los míos", "Mine")}</Link>
        </div>
      </div>

      {err === "cliente-nuevo" && <p className="note risk">{t("Para crear el cliente nuevo falta el nombre de la empresa.", "To create the new customer, the company name is missing.")}</p>}
      {err === "nueva" && <p className="note risk">{t("Para crear la Necesidad faltan el cliente y el asunto.", "To create the Need, the customer and the subject are missing.")}</p>}
      <NewNeedForm lang={user.lang} action={createNeed} accounts={accounts} contacts={contacts.flatMap((c) => (c.accountId ? [{ id: c.id, accountId: c.accountId, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email }] : []))} parts={parts.map((x) => ({ code: x.mpn, name: x.name }))} machines={machines} defaultFollowUp={dayInput(addWorkingDays(now, 2))} aiReady={aiConfigured()} aiSeed={aiSeed ?? mailSeed} />
      {mailErr && <p className="note risk">{t("No se pudo abrir ese correo del buzón. Vuelve a «Correos del buzón» y elígelo otra vez.", "That mailbox email could not be opened. Go back to “Mailbox emails” and pick it again.")}</p>}

      <section className="sum">
        <div data-tone={mineNow.length > 0 ? "info" : undefined}><span className="k">{t("Tu paso ahora", "Your step now")}</span><span className="v">{mineNow.length}</span><span className="s">{t("Necesidades con un paso nuestro para hoy", "Needs with a step of ours for today")}</span>{mineNow[0] && <Link className="go" href={`/deals/${mineNow[0].id}`}>{t("Abrir el primero", "Open the first one")} →</Link>}</div>
        <div><span className="k">{t("En curso", "In progress")}</span><span className="v">{open.length}</span><span className="s">{i.money(open.reduce((s, d) => s + Number(d.amount), 0))}</span></div>
        <div data-tone={noMove.length > 0 ? "attn" : "ok"}><span className="k">{t("Sin siguiente movimiento", "No next movement")}</span><span className="v">{noMove.length}</span><span className="s">{noMove.length > 0 ? t("conviene definir qué sigue", "worth deciding what's next") : t("todos tienen qué sigue", "all have a next step")}</span>{noMove[0] && <Link className="go" href={`/deals/${noMove[0].id}`}>{t("Abrir el primero", "Open the first one")} →</Link>}</div>
        <div><span className="k">{t("OC aceptadas", "POs accepted")}</span><span className="v">{deals.filter((d) => d.stage === "WON").length}</span><span className="s">{t(`${closedCount} Necesidades cerradas en el historial`, `${closedCount} closed Needs in history`)}</span></div>
      </section>
      <Split label={t("Valor en curso por etapa", "Value in progress by stage")} caption={<><b>{t("DÓNDE ESTÁ EL VALOR EN CURSO", "WHERE THE VALUE IN PROGRESS SITS")}</b> · {t("el azul se hace más profundo a medida que la Necesidad avanza", "the blue gets deeper as the Need advances")}</>} parts={STAGES.filter((s) => s !== "WON" && s !== "LOST").map((s, n) => { const col = open.filter((d) => d.stage === s); const sum = col.reduce((x, d) => x + Number(d.amount), 0); return { key: s, label: stageLabel(i, s), value: sum, tone: (["s1", "s2", "s3", "s4"] as const)[Math.min(n, 3)], text: i.money(sum), n: col.length }; })} />


      <PathLegend es={i.es} />
      <div className="kanban">
        {STAGES.map((s) => {
          const column = deals.filter((d) => d.stage === s);
          const total = column.reduce((sum, d) => sum + Number(d.amount), 0);
          const card = (d: (typeof deals)[number]) => {
                const eg = esagra(d);
                const late = d.nextMoveDate && d.nextMoveDate < now;
                const ask = cardAsk({ ...d, deliveries: d._count.deliveries }, now);
                return (
                  <article className="deal" key={d.id} data-ask={ask ?? undefined} title={ask ? W[ask] : undefined}>
                    <Link href={`/deals/${d.id}`}><b>{d.title}</b></Link>
                    <span className="src">{d.code ?? ""} · {d.account.name}</span>
                    <span className="row" style={{ justifyContent: "space-between" }}>
                      <span className="val">{i.money(d.amount)}</span>
                      {eg.pct != null && Number(d.supplierCost) > 0 && <span className="src" title={t("Eságara", "Eságara")}>{i.pct(eg.pct)}</span>}
                    </span>
                    {d.waitingFor ? (
                      <span className="src">⏸ {d.waitingFor}</span>
                    ) : d.nextMove ? (
                      <span className={`src ${late ? "attn-t" : ""}`}>→ {d.nextMove}{d.nextMoveDate ? ` · ${i.day(d.nextMoveDate)}` : ""}</span>
                    ) : s !== "LOST" && s !== "WON" ? (
                      <span className="src attn-t">{t("Sin siguiente movimiento", "No next movement")}</span>
                    ) : null}
                    <span className="src">{d.owner.name}</span>
                    {canEdit(user, d.ownerId) && (
                      <form action={moveDealStage.bind(null, d.id)}>
                        <AutoSubmitSelect name="stage" defaultValue={d.stage} aria-label={t("Mover a etapa", "Move to stage")}>
                          {STAGES.map((st) => <option key={st} value={st}>{stageLabel(i, st)}</option>)}
                        </AutoSubmitSelect>
                      </form>
                    )}
                  </article>
                );
          };
          const CAP = 8;
          return (
            <section className="column" key={s} data-stage={s}>
              <h2><span>{stageLabel(i, s)} ({column.length})</span><span className="muted">{i.n(total)}</span></h2>
              {column.slice(0, CAP).map(card)}
              {column.length > CAP && (
                <details className="kb-more">
                  <summary>{t(`Ver ${column.length - CAP} más`, `Show ${column.length - CAP} more`)}</summary>
                  {column.slice(CAP).map(card)}
                </details>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
