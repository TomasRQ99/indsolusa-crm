import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { addDays, invoiceBlockers, today } from "@/lib/domain";
import { loadCredit, loadReceivables, loadSupplierPayments } from "@/lib/queries";

type Item = { key: string; title: string; detail: string; sig?: { text: string; cls: string }; href: string; cta: string; when?: number };

export default async function MiDiaPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const manager = canManageAll(user);
  const now = today();
  const week = addDays(now, 7);
  const mineDeal = manager ? {} : { ownerId: user.id };

  const [deals, tasks, receivables, deliveries, payments, credit, spos] = await Promise.all([
    db.deal.findMany({
      where: { ownerId: user.id, stage: { not: "LOST" }, resultAchievedAt: null },
      include: { account: { select: { name: true } } },
    }),
    db.task.findMany({
      where: { assigneeId: user.id, status: "OPEN", dueDate: { lte: now } },
      include: { deal: { select: { id: true, code: true } }, account: { select: { id: true, name: true } } },
      orderBy: { dueDate: "asc" },
    }),
    loadReceivables({ deal: mineDeal }),
    db.delivery.findMany({
      where: { invoice: null, deal: mineDeal },
      include: { deal: { include: { account: true } } },
    }),
    loadSupplierPayments({ executedAt: null }),
    manager ? loadCredit() : Promise.resolve([]),
    db.supplierPO.findMany({
      where: { receivedAt: null, eta: { gte: now, lt: week }, deal: mineDeal },
      include: { supplier: { select: { name: true } }, deal: { select: { id: true, code: true } } },
    }),
  ]);

  const act: Item[] = [];
  const coming: Item[] = [];
  const waiting: Item[] = [];

  for (const r of receivables) {
    if (r.state === "BROKEN" && r.promise) {
      act.push({
        key: `p-${r.id}`,
        title: t(`${r.account.name}: no llegó el pago prometido`, `${r.account.name}: promised payment did not arrive`),
        detail: t(
          `Factura ${r.number} · ${i.money(r.cash.balance)} · ${r.promise.promisedBy} prometió pagar el ${i.dateShort(r.promise.promisedFor)}`,
          `Invoice ${r.number} · ${i.money(r.cash.balance)} · ${r.promise.promisedBy} promised to pay on ${i.dateShort(r.promise.promisedFor)}`,
        ),
        sig: { text: t("Compromiso incumplido", "Commitment missed"), cls: "missed" },
        href: `/administracion/cobrar?f=${r.id}`,
        cta: t("Preparar contacto", "Prepare contact"),
        when: 0,
      });
    } else if (r.promise && r.promise.promisedFor >= now && r.promise.promisedFor < week) {
      coming.push({ key: `pc-${r.id}`, title: t(`${r.account.name} prometió pagar ${i.money(r.cash.balance)}`, `${r.account.name} promised to pay ${i.money(r.cash.balance)}`), detail: `${i.dateShort(r.promise.promisedFor)} · ${r.number}`, href: `/administracion/cobrar?f=${r.id}`, cta: t("Ver", "View"), when: r.promise.promisedFor.getTime() });
    } else if (r.state === "UPCOMING" && r.dueAt < week) {
      coming.push({ key: `d-${r.id}`, title: t(`Vence la factura ${r.number} de ${r.account.name}`, `Invoice ${r.number} for ${r.account.name} falls due`), detail: `${i.dateShort(r.dueAt)} · ${i.money(r.cash.balance)}`, href: `/administracion/cobrar?f=${r.id}`, cta: t("Ver", "View"), when: r.dueAt.getTime() });
    }
  }

  for (const d of deals) {
    const label = `${d.code ? d.code + " · " : ""}${d.title}`;
    if (d.waitingFor) {
      if (d.waitingUntil && d.waitingUntil < now) {
        act.push({ key: `w-${d.id}`, title: t(`Revisar la espera: ${d.waitingFor}`, `Check the wait: ${d.waitingFor}`), detail: `${label} · ${d.account.name}`, sig: { text: t("La espera venció", "Wait expired"), cls: "attn" }, href: `/deals/${d.id}`, cta: t("Abrir Journey", "Open Journey"), when: d.waitingUntil.getTime() });
      } else {
        waiting.push({ key: `wc-${d.id}`, title: d.waitingFor, detail: `${label} · ${t("revisar el", "check on")} ${i.dateShort(d.waitingUntil)}`, href: `/deals/${d.id}`, cta: t("Ver", "View") });
      }
    } else if (d.nextMove) {
      if (!d.nextMoveDate || d.nextMoveDate <= now) {
        const late = d.nextMoveDate && d.nextMoveDate < now;
        act.push({ key: `m-${d.id}`, title: d.nextMove, detail: `${label} · ${d.account.name}`, sig: late ? { text: t(`Era para el ${i.day(d.nextMoveDate)}`, `Was due ${i.day(d.nextMoveDate)}`), cls: "attn" } : { text: t("Hoy", "Today"), cls: "info" }, href: `/deals/${d.id}`, cta: t("Abrir Journey", "Open Journey"), when: d.nextMoveDate?.getTime() ?? 0 });
      } else if (d.nextMoveDate < week) {
        coming.push({ key: `mc-${d.id}`, title: d.nextMove, detail: `${i.dateShort(d.nextMoveDate)} · ${label}`, href: `/deals/${d.id}`, cta: t("Ver", "View"), when: d.nextMoveDate.getTime() });
      }
    } else if (!d.resultAchievedAt && d.stage !== "WON") {
      // Accepted orders move through the derived chain (purchase, payment, delivery…), so they don't need a manual next move.
      act.push({ key: `n-${d.id}`, title: t(`${label} no tiene siguiente movimiento`, `${label} has no next movement`), detail: t(`${d.account.name} · define qué sigue o una espera con control`, `${d.account.name} · set what's next or a controlled wait`), sig: { text: t("Necesita claridad", "Needs clarity"), cls: "attn" }, href: `/deals/${d.id}`, cta: t("Definir", "Set"), when: 1 });
    }
    if (d.promisedDate && d.promisedDate >= now && d.promisedDate < week) {
      coming.push({ key: `pr-${d.id}`, title: t(`Promesa al cliente: ${d.promiseText ?? d.title}`, `Customer promise: ${d.promiseText ?? d.title}`), detail: `${i.dateShort(d.promisedDate)} · ${label}`, href: `/deals/${d.id}`, cta: t("Ver", "View"), when: d.promisedDate.getTime() });
    }
  }

  for (const d of deliveries) {
    if (invoiceBlockers(d, d.deal, d.deal.account).length === 0) {
      act.push({ key: `inv-${d.id}`, title: t(`Lista para facturar: ${d.code}`, `Ready to invoice: ${d.code}`), detail: `${d.deal.account.name} · ${d.deal.code ?? d.deal.title}`, sig: { text: t("Lista", "Ready"), cls: "ok" }, href: `/operaciones/remisiones/${d.id}`, cta: t("Emitir factura", "Issue invoice"), when: 2 });
    }
  }

  for (const p of payments) {
    if (p.state === "VERIFY" && p.requestedById !== user.id) {
      act.push({ key: `v-${p.id}`, title: t(`Verificar datos bancarios de ${p.supplierPo.supplier.name}`, `Verify ${p.supplierPo.supplier.name}'s bank data`), detail: `${p.currency} ${i.n2(p.amount)} · ${p.discrepancies.length} ${t("diferencias con el perfil verificado", "differences with the verified profile")}`, sig: { text: t("Requiere verificación", "Needs verification"), cls: "risk" }, href: `/administracion/pagos-proveedores/${p.id}`, cta: t("Verificar", "Verify"), when: p.dueBy?.getTime() ?? 3 });
    }
    if (manager && p.state === "APPROVE" && p.requestedById !== user.id && p.verifiedById !== user.id) {
      act.push({ key: `a-${p.id}`, title: t(`Aprobar pago a ${p.supplierPo.supplier.name}`, `Approve payment to ${p.supplierPo.supplier.name}`), detail: `${p.currency} ${i.n2(p.amount)} · ${p.reason}`, sig: { text: t("Espera tu aprobación", "Awaiting your approval"), cls: "attn" }, href: `/administracion/pagos-proveedores/${p.id}`, cta: t("Revisar", "Review"), when: p.dueBy?.getTime() ?? 3 });
    }
  }

  for (const a of credit) {
    for (const d of a.blocking) {
      act.push({ key: `c-${d.id}`, title: t(`${a.name} supera su cupo con ${d.code ?? d.title}`, `${a.name} exceeds its credit limit with ${d.code ?? d.title}`), detail: t(`Usado ${i.money(a.used)} de ${i.money(a.limit)}`, `Used ${i.money(a.used)} of ${i.money(a.limit)}`), sig: { text: t("Decisión de gerencia", "Management decision"), cls: "attn" }, href: `/administracion/cupos#${a.id}`, cta: t("Ver opciones", "See options"), when: 2 });
    }
  }

  for (const tk of tasks) {
    act.push({ key: `t-${tk.id}`, title: tk.title, detail: [tk.deal?.code, tk.account?.name].filter(Boolean).join(" · ") || t("Pendiente", "To-do"), sig: tk.dueDate && tk.dueDate < now ? { text: t(`Era para el ${i.day(tk.dueDate)}`, `Was due ${i.day(tk.dueDate)}`), cls: "attn" } : { text: t("Hoy", "Today"), cls: "info" }, href: tk.deal ? `/deals/${tk.deal.id}` : "/tasks", cta: t("Abrir", "Open"), when: tk.dueDate?.getTime() ?? 5 });
  }

  for (const s of spos) {
    coming.push({ key: `s-${s.id}`, title: t(`Llega a bodega: ${s.supplier.name}`, `Arriving: ${s.supplier.name}`), detail: `ETA ${i.dateShort(s.eta)} · ${s.code} · ${s.deal.code ?? ""}`, href: `/deals/${s.deal.id}`, cta: t("Ver", "View"), when: s.eta!.getTime() });
  }

  act.sort((a, b) => (a.when ?? 0) - (b.when ?? 0));
  coming.sort((a, b) => (a.when ?? 0) - (b.when ?? 0));

  const List = ({ items, empty }: { items: Item[]; empty: [string, string] }) =>
    items.length === 0 ? (
      <p className="empty small"><b>{empty[0]}</b>{empty[1]}</p>
    ) : (
      <div className="items">
        {items.map((it) => (
          <div className="item" key={it.key}>
            <div className="t">{it.title}</div>
            <div className="a">{it.sig && <span className={`sig ${it.sig.cls}`}>{it.sig.text}</span>}<Link className="btn secondary sm" href={it.href}>{it.cta}</Link></div>
            <div className="d">{it.detail}</div>
          </div>
        ))}
      </div>
    );

  const first = user.name.split(" ")[0];
  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb">{t("Mi día", "My day")} · {i.dateShort(now)}</div>
          <h1>{act.length ? t(`${first}, hay ${act.length} cosas donde tu movimiento cambia el resultado`, `${first}, ${act.length} things where your move changes the outcome`) : t(`${first}, todo se mueve con normalidad`, `${first}, everything is moving normally`)}</h1>
          <p>{t("Lo que se mueve solo no aparece aquí. Solo lo que necesita tu criterio, tu autorización o tu relación con el cliente.", "What moves on its own isn't shown here. Only what needs your judgment, authority or customer relationship.")}</p>
        </div>
        <div className="grow" />
        <Link className="btn secondary" href="/mi-plan">{t("Ver Mi Plan", "Open My Plan")}</Link>
      </div>

      <section className="sum">
        <div><span className="k">{t("¿Necesito actuar?", "Do I need to act?")}</span><span className="v">{act.length}</span><span className="s">{t("movimientos tuyos", "moves for you")}</span></div>
        <div><span className="k">{t("¿Qué viene?", "What's coming?")}</span><span className="v">{coming.length}</span><span className="s">{t("en los próximos 7 días", "in the next 7 days")}</span></div>
        <div><span className="k">{t("Esperando con control", "Waiting with control")}</span><span className="v">{waiting.length}</span><span className="s">{t("SOLU te avisa en la fecha", "SOLU reminds you on the date")}</span></div>
      </section>

      <div className="two">
        <div className="card">
          <div className="bhead"><h2>{t("Necesita tu movimiento", "Needs your move")}</h2></div>
          <List items={act} empty={[t("Nada urgente", "Nothing urgent"), t("Buen momento para avanzar en lo importante de Mi Plan.", "Good time to move ahead on what matters in My Plan.")]} />
        </div>
        <div className="rail">
          <div className="card">
            <div className="bhead"><h2>{t("Qué viene · 7 días", "What's coming · 7 days")}</h2></div>
            <List items={coming} empty={[t("Semana tranquila", "Quiet week"), t("No hay fechas comprometidas en los próximos 7 días.", "No committed dates in the next 7 days.")]} />
          </div>
          <div className="card">
            <div className="bhead"><h2>{t("Esperando con control", "Waiting with control")}</h2></div>
            <List items={waiting} empty={[t("Sin esperas", "No waits"), t("Nada está esperando a un tercero.", "Nothing is waiting on a third party.")]} />
          </div>
        </div>
      </div>
    </>
  );
}
