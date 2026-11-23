import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { canManageAll } from "./permissions";
import { daysBetween, invoiceBlockers, today } from "./domain";
import { loadReceivables } from "./queries";
import { pendingFor } from "./pending";

// RESUMEN DEL DÍA: the window that greets a person the first time they enter SOLU each day (owner, 2026-11-23:
// "shows movements that are very urgent first to less at the bottom, considering more urgent if they have spent
// longer without updates"). It adds no rule of its own: each group is something SOLU already knows, put in order.
//   · Groups go from what puts a result at risk (red) to what only needs a movement (amber) to today's to-dos.
//   · Inside a group, the case that has waited longest comes first.
//   · A Need that is waiting with control (a wait or a next movement with a date still ahead) is left alone.

/** Days without any follow-up after which a presented quote or an open Need is brought up. */
export const BRIEF_QUIET_DAYS = 7;
/** Rows sent per group; the window shows the first ones and opens the rest on request. */
const MAX_ROWS = 12;

export type BriefTone = "risk" | "attn" | "info";
export type BriefRow = { key: string; code: string; who: string; days: number | null; badge: string; text: string; href: string; cta: string; owner?: string };
export type BriefGroup = { key: string; tone: BriefTone; title: string; advice: string; total: number; rows: BriefRow[]; all: { label: string; href: string } };
export type DayBrief = { groups: BriefGroup[]; canTeam: boolean; scope: "mine" | "team" };

const strip = (s: string) => s.replace(/ \(ejemplo\)$/, "");
/** The Bogotá calendar day of a real timestamp, as UTC midnight (the way "day" dates are stored). */
const dayOf = (d: Date) => { const b = new Date(d.getTime() - 5 * 3600e3); return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())); };
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export async function buildDayBrief(user: SessionUser, i: I18n, wanted: "mine" | "team" = "mine"): Promise<DayBrief> {
  const { t } = i;
  const canTeam = canManageAll(user);
  const scope = wanted === "team" && canTeam ? "team" : "mine";
  const team = scope === "team";
  const own = team ? {} : { ownerId: user.id };
  const now = today();

  const [deals, receivables, deliveries, tasks, pending] = await Promise.all([
    db.deal.findMany({
      where: { ...own, internal: false, stage: { not: "LOST" }, closedAt: null, resultAchievedAt: null },
      select: {
        id: true, code: true, title: true, stage: true, promisedDate: true, nextMove: true, nextMoveDate: true, waitingFor: true, waitingUntil: true, updatedAt: true,
        owner: { select: { name: true } },
        account: { select: { name: true } },
        activities: { orderBy: { occurredAt: "desc" }, take: 1, select: { subject: true, occurredAt: true } },
        quotes: { where: { status: "PRESENTED" }, orderBy: { presentedAt: "desc" }, take: 1, select: { id: true, number: true, rev: true, presentedAt: true } },
        _count: { select: { deliveries: true } },
      },
    }),
    loadReceivables({ deal: own }),
    db.delivery.findMany({ where: { invoice: null, deal: { ...own, internal: false } }, include: { deal: { include: { account: true, owner: { select: { name: true } } } } } }),
    team ? Promise.resolve([]) : db.task.findMany({
      where: { assigneeId: user.id, status: "OPEN", dueDate: { lte: now } },
      orderBy: { dueDate: "asc" }, take: 60,
      select: { id: true, title: true, dueDate: true, dealId: true, projectId: true, deal: { select: { code: true, account: { select: { name: true } } } }, account: { select: { name: true } }, project: { select: { title: true } } },
    }),
    pendingFor(user).then((p) => p.mine).catch(() => []),
  ]);

  const ago = (n: number) => (n <= 0 ? t("hoy", "today") : n === 1 ? t("ayer", "yesterday") : t(`hace ${n} días`, `${n} days ago`));
  const badge = (n: number) => (n <= 0 ? t("hoy", "today") : `${n} d`);
  type D = (typeof deals)[number];
  const followUp = (d: D) => {
    const a = d.activities[0];
    return a
      ? t(`Último seguimiento ${ago(daysBetween(dayOf(a.occurredAt), now))}: «${cut(a.subject, 90)}».`, `Last follow-up ${ago(daysBetween(dayOf(a.occurredAt), now))}: "${cut(a.subject, 90)}".`)
      : t("Todavía no hay ningún seguimiento registrado.", "No follow-up has been recorded yet.");
  };
  const dealRow = (d: D, days: number, text: string, cta = t("Abrir", "Open"), href = `/deals/${d.id}`): BriefRow => ({
    key: d.id, code: d.code ?? "", who: strip(d.account.name), days, badge: badge(days), text, href, cta, owner: team ? d.owner.name : undefined,
  });

  const late: BriefRow[] = [], moves: BriefRow[] = [], quotes: BriefRow[] = [], quiet: BriefRow[] = [];
  for (const d of deals) {
    if (d.stage === "WON") {
      // An accepted order whose promised date passed and nothing has been delivered yet.
      if (d.promisedDate && d.promisedDate < now && d._count.deliveries === 0) {
        late.push(dealRow(d, daysBetween(d.promisedDate, now), `${t(`Se prometió para el ${i.dateShort(d.promisedDate)} y aún no tiene entrega registrada.`, `Promised for ${i.dateShort(d.promisedDate)} and no delivery is recorded yet.`)} ${followUp(d)}`, t("Avisar", "Notify"), `/deals/${d.id}/retraso`));
      }
      continue;
    }
    if (d.waitingFor) {
      if (d.waitingUntil && d.waitingUntil < now) moves.push(dealRow(d, daysBetween(d.waitingUntil, now), `${t(`Esperabas «${cut(d.waitingFor, 80)}» hasta el ${i.dateShort(d.waitingUntil)}.`, `You were waiting for "${cut(d.waitingFor, 80)}" until ${i.dateShort(d.waitingUntil)}.`)} ${followUp(d)}`));
      continue; // otherwise: waiting with control
    }
    if (d.nextMove) {
      if (!d.nextMoveDate || d.nextMoveDate <= now) {
        const n = d.nextMoveDate ? daysBetween(d.nextMoveDate, now) : 0;
        moves.push(dealRow(d, n, `${n > 0 ? t(`Quedó para el ${i.dateShort(d.nextMoveDate)}: «${cut(d.nextMove, 90)}».`, `It was set for ${i.dateShort(d.nextMoveDate)}: "${cut(d.nextMove, 90)}".`) : t(`Es el movimiento de hoy: «${cut(d.nextMove, 90)}».`, `Today's move: "${cut(d.nextMove, 90)}".`)} ${followUp(d)}`));
      }
      continue; // otherwise: the next movement has its date ahead
    }
    // No next movement and no wait: how long since anyone followed up?
    const q = d.quotes[0];
    const a = d.activities[0];
    if (q?.presentedAt) {
      const last = a && a.occurredAt > q.presentedAt ? a.occurredAt : q.presentedAt;
      const n = daysBetween(dayOf(last), now);
      if (n >= BRIEF_QUIET_DAYS) quotes.push({ ...dealRow(d, n, `${t(`Se presentó el ${i.dateShort(dayOf(q.presentedAt))}.`, `Presented on ${i.dateShort(dayOf(q.presentedAt))}.`)} ${followUp(d)}`, t("Abrir", "Open"), `/cotizaciones/${q.id}`), key: q.id, code: `${q.number}${q.rev ? ` Rev. ${q.rev}` : ""}` });
    } else {
      const last = a && a.occurredAt > d.updatedAt ? a.occurredAt : d.updatedAt;
      const n = daysBetween(dayOf(last), now);
      if (n >= BRIEF_QUIET_DAYS) quiet.push(dealRow(d, n, `${cut(d.title, 80)}. ${followUp(d)}`));
    }
  }

  const broken: BriefRow[] = [], overdue: BriefRow[] = [];
  for (const r of receivables) {
    const base = { key: r.id, code: r.number, who: strip(r.account.name), href: `/administracion/cobrar?f=${r.id}`, cta: t("Abrir", "Open"), owner: team ? r.account.owner?.name : undefined };
    if (r.state === "BROKEN" && r.promise) {
      const n = daysBetween(r.promise.promisedFor, now);
      broken.push({ ...base, days: n, badge: badge(n), text: t(`${r.promise.promisedBy} dio como fecha de pago el ${i.dateShort(r.promise.promisedFor)} y no hay pago registrado. Saldo: ${i.money(r.cash.balance)}.`, `${r.promise.promisedBy} gave ${i.dateShort(r.promise.promisedFor)} as the payment date and no payment is recorded. Balance: ${i.money(r.cash.balance)}.`) });
    } else if (r.state === "NEEDS_ACTION") {
      const n = daysBetween(r.dueAt, now);
      overdue.push({ ...base, days: n, badge: badge(n), text: t(`Venció el ${i.dateShort(r.dueAt)} y todavía no hay una fecha de pago acordada. Saldo: ${i.money(r.cash.balance)}.`, `Due since ${i.dateShort(r.dueAt)} with no payment date agreed yet. Balance: ${i.money(r.cash.balance)}.`) });
    }
  }

  const toInvoice: BriefRow[] = [];
  for (const dl of deliveries) {
    if (invoiceBlockers(dl, dl.deal, dl.deal.account).length) continue;
    const n = daysBetween(dayOf(dl.deliveredAt), now);
    toInvoice.push({ key: dl.id, code: dl.code, who: strip(dl.deal.account.name), days: n, badge: badge(n), text: t(`Se entregó el ${i.dateShort(dayOf(dl.deliveredAt))} y ya tiene lo que el cliente pide para facturar${dl.deal.code ? ` (${dl.deal.code})` : ""}.`, `Delivered on ${i.dateShort(dayOf(dl.deliveredAt))} and it already has what the customer requires to invoice${dl.deal.code ? ` (${dl.deal.code})` : ""}.`), href: "/operaciones/por-facturar", cta: t("Abrir", "Open"), owner: team ? dl.deal.owner.name : undefined });
  }

  const approvals: BriefRow[] = pending.map((p) => {
    const n = p.since ? daysBetween(dayOf(p.since), now) : null;
    const detail = p.detail ? t(p.detail.es, p.detail.en) : "";
    return { key: p.key, code: "", who: t(p.title.es, p.title.en), days: n, badge: n == null ? "" : badge(n), text: [p.amount, cut(detail, 170)].filter(Boolean).join(" · "), href: p.href, cta: t("Abrir", "Open") };
  });

  const todo: BriefRow[] = tasks.map((k) => {
    const n = daysBetween(k.dueDate!, now);
    const about = k.deal ? `${k.deal.code ? `${k.deal.code} · ` : ""}${strip(k.deal.account.name)}` : k.project ? k.project.title : k.account ? strip(k.account.name) : "";
    return { key: k.id, code: "", who: cut(k.title, 110), days: n, badge: badge(n), text: [about, n > 0 ? t(`Tenía fecha del ${i.dateShort(k.dueDate)}.`, `It was due on ${i.dateShort(k.dueDate)}.`) : t("Tiene fecha de hoy.", "It is due today.")].filter(Boolean).join(" · "), href: k.dealId ? `/deals/${k.dealId}` : k.projectId ? `/proyectos/${k.projectId}` : "/tasks", cta: t("Abrir", "Open") };
  });

  const groups: BriefGroup[] = [];
  const add = (key: string, tone: BriefTone, rows: BriefRow[], title: (n: number) => string, advice: string, all: { label: string; href: string }) => {
    if (!rows.length) return;
    // The longest wait first; a case with no date goes last.
    rows.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
    groups.push({ key, tone, title: title(rows.length), advice, total: rows.length, rows: rows.slice(0, MAX_ROWS), all });
  };
  const one = (n: number, es1: string, esN: string, en1: string, enN: string) => (n === 1 ? t(`1 ${es1}`, `1 ${en1}`) : t(`${n} ${esN}`, `${n} ${enN}`));

  add("late", "risk", late, (n) => one(n, "entrega pasó la fecha prometida", "entregas pasaron la fecha prometida", "delivery is past its promised date", "deliveries are past their promised date"),
    t("Conviene avisar al cliente y acordar una fecha nueva: es mejor que se entere por ti.", "It helps to tell the customer and agree a new date: better they hear it from you."), { label: t("Ver las entregas al cliente", "See customer deliveries"), href: "/operaciones/despachos" });
  add("broken", "risk", broken, (n) => one(n, "pago prometido no llegó en su fecha", "pagos prometidos no llegaron en su fecha", "promised payment did not arrive on its date", "promised payments did not arrive on their date"),
    t("Una llamada para acordar una fecha nueva, con una persona responsable, suele destrabarlo.", "A call to agree a new date, with a person in charge, usually unblocks it."), { label: t("Ver los cobros", "See collections"), href: "/administracion/cobrar" });
  add("approvals", "attn", approvals, (n) => one(n, "decisión espera tu aprobación", "decisiones esperan tu aprobación", "decision waits for your approval", "decisions wait for your approval"),
    t("Mientras no se decidan, el trabajo de otra persona queda detenido.", "Until they are decided, someone else's work stays on hold."), { label: t("Ver pendientes por aprobar", "See pending approvals"), href: "/profile/pendientes" });
  add("moves", "attn", moves, (n) => one(n, "movimiento acordado toca hoy o quedó atrás", "movimientos acordados tocan hoy o quedaron atrás", "agreed move is due today or overdue", "agreed moves are due today or overdue"),
    t("Hazlo, o cámbiale la fecha si ya no aplica: así el tablero dice la verdad.", "Do it, or change its date if it no longer applies: that keeps the board truthful."), { label: t("Ver en Mi Día", "See in My Day"), href: "/mi-dia" });
  add("overdue", "attn", overdue, (n) => one(n, "factura vencida sin fecha de pago acordada", "facturas vencidas sin fecha de pago acordada", "overdue invoice with no payment date agreed", "overdue invoices with no payment date agreed"),
    t("Pregunta al cliente cuándo paga y registra la fecha: SOLU la vigila por ti.", "Ask the customer when they will pay and record the date: SOLU watches it for you."), { label: t("Ver los cobros", "See collections"), href: "/administracion/cobrar" });
  add("quotes", "attn", quotes, (n) => t(`${n === 1 ? "1 cotización presentada" : `${n} cotizaciones presentadas`} sin seguimiento hace ${BRIEF_QUIET_DAYS} días o más`, `${n === 1 ? "1 presented quote" : `${n} presented quotes`} with no follow-up for ${BRIEF_QUIET_DAYS} days or more`),
    t("Retómalas: pregunta si sigue el interés y registra la respuesta; si ya no hay negocio, ciérralas.", "Pick them up again: ask whether the interest is still there and record the answer; if there is no business, close them."), { label: t("Ver las cotizaciones", "See quotes"), href: "/cotizaciones" });
  add("quiet", "attn", quiet, (n) => t(`${n === 1 ? "1 Necesidad" : `${n} Necesidades`} sin movimiento hace ${BRIEF_QUIET_DAYS} días o más`, `${n === 1 ? "1 Need" : `${n} Needs`} with no movement for ${BRIEF_QUIET_DAYS} days or more`),
    t("Define qué sigue con una fecha, o déjala como espera con control.", "Set what comes next with a date, or leave it as a controlled wait."), { label: t("Ver las Necesidades", "See Needs"), href: "/deals" });
  add("invoice", "attn", toInvoice, (n) => one(n, "entrega lista para facturar", "entregas listas para facturar", "delivery ready to invoice", "deliveries ready to invoice"),
    t("Cada día sin factura corre la fecha de cobro.", "Each day without an invoice pushes collection back."), { label: t("Ver por facturar", "See to invoice"), href: "/operaciones/por-facturar" });
  add("todo", "info", todo, (n) => one(n, "pendiente para hoy o con fecha vencida", "pendientes para hoy o con fecha vencida", "to-do due today or overdue", "to-dos due today or overdue"),
    t("Lo que anotaste para no olvidar.", "What you wrote down so you would not forget."), { label: t("Ver mis pendientes", "See my to-dos"), href: "/tasks" });

  return { groups, canTeam, scope };
}
