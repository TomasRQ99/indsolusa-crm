import { db } from "./db";
import { isWorkingDay } from "./holidays";
import { addDays, today } from "./domain";
import { absentOn } from "./admin-rules";

// Mi Plan: blocks derived from known commitments (to-dos and Journey next movements),
// placed into the person's real capacity, with a protected buffer for urgencies.
// It plans; it never measures anyone.

export const URGENCY_BUFFER = 0.3;
export const DEFAULT_MINUTES = 30;

export type PlanItem = {
  key: string;
  kind: "task" | "move";
  taskId?: string;
  dealId?: string;
  dealCode?: string | null;
  account?: string | null;
  title: string;
  minutes: number;
  due: Date | null;
  plannedFor?: Date | null;
};

export type PlanDay = {
  date: Date;
  capacity: number; // plannable minutes (after the urgency buffer)
  workday: number;
  planned: PlanItem[];
  proposed: PlanItem[];
};

export async function buildPlan(user: { id: string; workdayMinutes: number }, horizon = 7) {
  const start = today();
  const end = addDays(start, horizon); // exclusive
  const lastDay = addDays(end, -1);

  const [tasks, deals] = await Promise.all([
    db.task.findMany({
      where: { assigneeId: user.id, status: "OPEN" },
      include: { deal: { select: { id: true, code: true } }, account: { select: { name: true } } },
    }),
    db.deal.findMany({
      where: { ownerId: user.id, nextMove: { not: null }, stage: { not: "LOST" } },
      select: { id: true, code: true, nextMove: true, nextMoveDate: true, account: { select: { name: true } } },
    }),
  ]);

  // Módulo 14 §15: an approved absence leaves that day without capacity, so nothing is planned on it.
  const away = await db.absenceRecord.findMany({ where: { userId: user.id, status: "APPROVED", startsOn: { lte: lastDay }, endsOn: { gte: start } }, select: { status: true, startsOn: true, endsOn: true } });
  const days: PlanDay[] = [];
  for (let k = 0; k < horizon; k++) {
    const date = addDays(start, k);
    const workday = isWorkingDay(date) && !absentOn(away, date) ? user.workdayMinutes : 0;
    days.push({ date, workday, capacity: Math.round(workday * (1 - URGENCY_BUFFER)), planned: [], proposed: [] });
  }
  const dayOf = (d: Date) => days.find((x) => x.date.getTime() === d.getTime());
  const used = (d: PlanDay) => [...d.planned, ...d.proposed].reduce((s, i) => s + i.minutes, 0);

  const candidates: PlanItem[] = [];
  for (const tk of tasks) {
    const item: PlanItem = {
      key: `t-${tk.id}`,
      kind: "task",
      taskId: tk.id,
      dealId: tk.deal?.id,
      dealCode: tk.deal?.code,
      account: tk.account?.name ?? null,
      title: tk.title,
      minutes: tk.estimateMinutes ?? DEFAULT_MINUTES,
      due: tk.dueDate,
      plannedFor: tk.plannedFor,
    };
    const d = tk.plannedFor ? dayOf(tk.plannedFor) : undefined;
    if (d) d.planned.push(item);
    else candidates.push(item);
  }
  for (const d of deals) {
    const already = tasks.some((tk) => tk.dealId === d.id && tk.title === d.nextMove);
    if (already) continue;
    candidates.push({
      key: `m-${d.id}`,
      kind: "move",
      dealId: d.id,
      dealCode: d.code,
      account: d.account.name,
      title: d.nextMove!,
      minutes: DEFAULT_MINUTES,
      due: d.nextMoveDate,
    });
  }

  candidates.sort((a, b) => (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity));

  const worth: PlanItem[] = [];
  const canWait: PlanItem[] = [];
  const noFit: PlanItem[] = [];
  for (const c of candidates) {
    if (!c.due || c.due > lastDay) {
      canWait.push(c);
      continue;
    }
    const limit = c.due < start ? lastDay : c.due;
    const slot = days.find((d) => d.date <= limit && d.capacity - used(d) >= c.minutes);
    if (slot) {
      slot.proposed.push(c);
      worth.push(c);
    } else noFit.push(c);
  }

  const totals = {
    workday: days.reduce((s, d) => s + d.workday, 0),
    buffer: days.reduce((s, d) => s + (d.workday - d.capacity), 0),
    planned: days.reduce((s, d) => s + d.planned.reduce((x, i) => x + i.minutes, 0), 0),
    proposed: worth.reduce((s, i) => s + i.minutes, 0),
  };
  return { days, worth, canWait, noFit, totals, start, end };
}

export function hm(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}
