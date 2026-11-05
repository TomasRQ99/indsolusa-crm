import { db } from "./db";
import { understand } from "./comm";
import type { SessionUser } from "./auth";

/** Re-read a thread's inbound messages and refresh SOLU's proposals. Decisions a person already made are kept. */
export async function refreshUnderstanding(threadId: string) {
  const thread = await db.commThread.findUniqueOrThrow({
    where: { id: threadId },
    include: {
      messages: { where: { direction: "IN" }, orderBy: { sentAt: "asc" }, include: { attachments: { select: { mime: true } } } },
      items: true,
      account: { select: { name: true } },
    },
  });
  const pastItems = thread.accountId
    ? (await db.dealItem.findMany({ where: { deal: { accountId: thread.accountId } }, include: { deal: { select: { code: true, createdAt: true } } }, orderBy: { deal: { createdAt: "desc" } }, take: 40 }))
        .map((it) => ({ code: it.code, description: it.description, dealCode: it.deal.code }))
    : [];
  const openDeals = thread.accountId
    ? (await db.deal.findMany({ where: { accountId: thread.accountId, stage: { not: "LOST" }, resultAchievedAt: null }, include: { items: { select: { description: true } } } }))
        .map((d) => ({ id: d.id, code: d.code, title: d.title, items: d.items.map((x) => x.description) }))
    : [];
  const found = understand({
    messages: thread.messages.map((m) => ({ body: m.body, sentAt: m.sentAt, hasPhoto: m.attachments.some((a) => a.mime.startsWith("image/")) })),
    accountName: thread.account?.name ?? null,
    pastItems,
    openDeals,
  });
  const decided = new Set(thread.items.filter((x) => x.status !== "PROPOSED").map((x) => x.field));
  await db.$transaction([
    db.commItem.deleteMany({ where: { threadId, status: "PROPOSED" } }),
    db.commItem.createMany({
      data: found.filter((f) => !decided.has(f.field)).map((f) => ({ threadId, field: f.field, value: f.value, basis: f.basis, evidence: f.evidence, reasoning: f.reasoning ?? null })),
    }),
  ]);
}

/** Threads this person may see: their customers, plus unmatched ones. Managers see all. */
export function threadScope(user: SessionUser) {
  if (user.role === "ADMIN" || user.role === "MANAGER") return {};
  return { OR: [{ accountId: null }, { account: { ownerId: user.id } }] };
}

export type ThreadRow = Awaited<ReturnType<typeof loadThreads>>[number];

export async function loadThreads(user: SessionUser) {
  const threads = await db.commThread.findMany({
    where: { ...threadScope(user), lastAt: { gte: new Date(Date.now() - 45 * 864e5) } },
    include: {
      account: { select: { id: true, name: true, ownerId: true } },
      contact: { select: { firstName: true, lastName: true } },
      deal: { select: { id: true, code: true, title: true } },
      items: { select: { field: true, value: true, basis: true, status: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true, body: true, attachments: { select: { id: true } } } },
    },
    orderBy: { lastAt: "desc" },
    take: 60,
  });
  return threads.map((th) => {
    const proposed = th.items.filter((x) => x.status === "PROPOSED" && x.basis === "INFERENCE").length;
    const unanswered = !!th.lastInAt && (!th.lastOutAt || th.lastOutAt < th.lastInAt) && !th.closedAt;
    const urgent = th.items.some((x) => x.field === "urgency" && x.status !== "REJECTED");
    const needsYou = !th.closedAt && (unanswered || proposed > 0);
    const product = th.items.find((x) => x.field === "product" && x.status !== "REJECTED");
    const qty = th.items.find((x) => x.field === "qty" && x.status !== "REJECTED");
    const gist = product ? `${qty ? `${qty.value} ` : ""}${product.value}${urgent ? " · urgente" : ""}` : null;
    const rank = (needsYou ? 100 : 0) + (urgent ? 50 : 0) + (th.deal ? 10 : 0);
    return { ...th, proposed, unanswered, urgent, needsYou, gist, rank };
  });
}
