import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canEdit } from "@/lib/permissions";
import { STAGE_LABEL, STAGES, formatDate, formatMoney } from "@/lib/format";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { createDeal, deleteDeal, moveDealStage } from "./actions";

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const user = await requireUser();
  const { mine } = await searchParams;

  const [deals, accounts] = await Promise.all([
    db.deal.findMany({
      where: mine ? { ownerId: user.id } : undefined,
      orderBy: { updatedAt: "desc" },
      include: {
        account: { select: { id: true, name: true } },
        owner: { select: { name: true } },
      },
    }),
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <div className="spread">
        <h1>Deals pipeline</h1>
        <div className="row small">
          <Link href="/deals">All deals</Link> · <Link href="/deals?mine=1">My deals</Link>
        </div>
      </div>

      <div className="card">
        <h2>New deal</h2>
        <form action={createDeal} className="inline">
          <label>Title<input name="title" required /></label>
          <label>
            Account
            <select name="accountId" required defaultValue="">
              <option value="" disabled>Select…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Amount (USD)<input name="amount" type="number" min="0" step="100" required /></label>
          <label>Close date<input name="closeDate" type="date" /></label>
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="kanban">
        {STAGES.map((s) => {
          const column = deals.filter((d) => d.stage === s);
          const total = column.reduce((sum, d) => sum + Number(d.amount), 0);
          return (
            <section className="column" key={s}>
              <h2>
                <span>{STAGE_LABEL[s]} ({column.length})</span>
                <span className="muted">{formatMoney(total)}</span>
              </h2>
              {column.map((d) => (
                <article className="deal" key={d.id}>
                  <strong>{d.title}</strong>
                  <Link href={`/accounts/${d.account.id}`}>{d.account.name}</Link>
                  <span>{formatMoney(d.amount)}</span>
                  <span className="muted small">{d.owner.name} · close {formatDate(d.closeDate)}</span>
                  {canEdit(user, d.ownerId) && (
                    <div className="spread">
                      <form action={moveDealStage.bind(null, d.id)}>
                        <AutoSubmitSelect name="stage" defaultValue={d.stage} aria-label="Move to stage">
                          {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
                        </AutoSubmitSelect>
                      </form>
                      <form action={deleteDeal.bind(null, d.id)}>
                        <button className="link small" type="submit">Delete</button>
                      </form>
                    </div>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
