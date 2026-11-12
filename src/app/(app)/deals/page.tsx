import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, esagra, today } from "@/lib/domain";
import { STAGES, stageLabel } from "@/lib/labels";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Split } from "@/components/Viz";
import { createDeal, moveDealStage } from "./actions";

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { mine } = await searchParams;
  const now = today();

  // The board shows working Journeys: closed ones and losses older than 90 days stay in history
  // (Customer 360, Insights), so this page doesn't grow forever.
  const scope = mine ? { ownerId: user.id } : {};
  const [deals, accounts, closedCount] = await Promise.all([
    db.deal.findMany({
      where: { ...scope, internal: false, closedAt: null, OR: [{ stage: { not: "LOST" } }, { updatedAt: { gte: addDays(now, -90) } }] },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, code: true, title: true, stage: true, amount: true, supplierCost: true, freightCost: true, otherCosts: true, nextMove: true, nextMoveDate: true, waitingFor: true, ownerId: true,
        account: { select: { id: true, name: true } }, owner: { select: { name: true } },
      },
    }),
    db.account.findMany({ where: { internal: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.deal.count({ where: { ...scope, closedAt: { not: null } } }),
  ]);

  const open = deals.filter((d) => !["WON", "LOST"].includes(d.stage));
  const noMove = open.filter((d) => !d.nextMove && !d.waitingFor);

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Comercial", "Commercial")}</div>
          <h1>{t("Journeys y negocios", "Journeys & deals")}</h1>
          <p>{t("Cada Journey une la necesidad del cliente con la compra, la entrega, la factura, el cobro y el resultado.", "Each Journey links the customer's need to purchasing, delivery, invoice, cash and result.")}</p>
        </div>
        <div className="grow" />
        <div className="row small">
          <Link href="/deals">{t("Todos", "All")}</Link> · <Link href="/deals?mine=1">{t("Los míos", "Mine")}</Link>
        </div>
      </div>

      <section className="sum">
        <div><span className="k">{t("En curso", "In progress")}</span><span className="v">{open.length}</span><span className="s">{i.money(open.reduce((s, d) => s + Number(d.amount), 0))}</span></div>
        <div data-tone={noMove.length > 0 ? "attn" : "ok"}><span className="k">{t("Sin siguiente movimiento", "No next movement")}</span><span className="v">{noMove.length}</span><span className="s">{noMove.length > 0 ? t("conviene definir qué sigue", "worth deciding what's next") : t("todos tienen qué sigue", "all have a next step")}</span>{noMove[0] && <Link className="go" href={`/deals/${noMove[0].id}`}>{t("Abrir el primero", "Open the first one")} →</Link>}</div>
        <div><span className="k">{t("OC aceptadas", "POs accepted")}</span><span className="v">{deals.filter((d) => d.stage === "WON").length}</span><span className="s">{t(`${closedCount} Journeys cerrados en el historial`, `${closedCount} closed Journeys in history`)}</span></div>
      </section>
      <Split label={t("Valor en curso por etapa", "Value in progress by stage")} caption={<><b>{t("DÓNDE ESTÁ EL VALOR EN CURSO", "WHERE THE VALUE IN PROGRESS SITS")}</b> · {t("el azul se hace más profundo a medida que el Journey avanza", "the blue gets deeper as the Journey advances")}</>} parts={STAGES.filter((s) => s !== "WON" && s !== "LOST").map((s, n) => { const col = open.filter((d) => d.stage === s); const sum = col.reduce((x, d) => x + Number(d.amount), 0); return { key: s, label: stageLabel(i, s), value: sum, tone: (["s1", "s2", "s3", "s4"] as const)[Math.min(n, 3)], text: i.money(sum), n: col.length }; })} />

      <details className="card">
        <summary>{t("Nuevo Journey", "New Journey")}</summary>
        <form action={createDeal} className="inline">
          <input type="hidden" name="open" value="1" />
          <label style={{ flex: 1, minWidth: 220 }}>{t("Qué necesita el cliente", "What the customer needs")}<input name="title" required /></label>
          <label>{t("Cliente", "Customer")}
            <select name="accountId" required defaultValue="">
              <option value="" disabled>{t("Elegir…", "Choose…")}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>{t("Venta estimada USD", "Estimated sale USD")}<input name="amount" type="number" min="0" step="100" required style={{ width: 140 }} /></label>
          <label>{t("Cierre esperado", "Expected close")}<input name="closeDate" type="date" /></label>
          <button type="submit">{t("Crear y abrir", "Create and open")}</button>
        </form>
      </details>

      <div className="kanban">
        {STAGES.map((s) => {
          const column = deals.filter((d) => d.stage === s);
          const total = column.reduce((sum, d) => sum + Number(d.amount), 0);
          const card = (d: (typeof deals)[number]) => {
                const eg = esagra(d);
                const late = d.nextMoveDate && d.nextMoveDate < now;
                return (
                  <article className="deal" key={d.id}>
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
