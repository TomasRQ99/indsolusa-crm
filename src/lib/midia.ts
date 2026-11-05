import type { SessionUser } from "./auth";
import type { I18n } from "./i18n";
import { db } from "./db";
import { canManageAll } from "./permissions";
import { addDays, daysBetween, esagra, invoiceBlockers, today } from "./domain";
import { loadCredit, loadReceivables, loadSupplierPayments } from "./queries";
import { agendaFor, hhmm, type OutlookEvent } from "./outlook";
import { stageLabel } from "./labels";

// MI DÍA for a negotiator. Not a dashboard, not an inbox: it answers where the person's
// attention changes a result today, what is worth moving early, and what can be left alone.
// Every "Necesita de ti" case reads: who → why now → what changed → impact → useful move.

export type Tone = "risk" | "move" | "clarity";
export type Fact = { text: string; src?: string };
export type Need = {
  key: string;
  tone: Tone;
  rank: number; // consequence: lower = more serious
  at: number; // deadline (ms) for ordering
  due: { main: string; sub?: string };
  who: { title: string; sub: string };
  why: Fact;
  changed: Fact;
  impact: Fact;
  next: string;
  nextNote?: string;
  primary: { label: string; href: string };
  context: string;
  schedule?: { dealId: string; title: string; minutes: number; scheduledAt: Date | null };
};
export type FutureItem = { key: string; title: string; text: string; at: Date; chip: string; window: boolean; link: { label: string; href: string } };
export type WaitItem = { key: string; what: string; from: string; until: Date; trigger: string; href: string };
export type Signal = { key: string; title: string; text: string; src: string; inferred?: boolean; href?: string };

const MAX_NEEDS = 5;
const HORIZON = 21;
const strip = (s: string) => s.replace(/ \(ejemplo\)$/, "");

export async function buildMiDia(user: SessionUser, i: I18n, opts: { agenda?: boolean } = {}) {
  const { t } = i;
  const manager = canManageAll(user);
  const now = today();
  const horizon = addDays(now, HORIZON);
  const mineDeal = manager ? {} : { ownerId: user.id };

  const [deals, receivables, deliveries, payments, credit, scheduled, agenda] = await Promise.all([
    db.deal.findMany({
      where: { ownerId: user.id, stage: { not: "LOST" }, resultAchievedAt: null },
      include: {
        account: { include: { contacts: { select: { firstName: true, lastName: true, title: true, email: true } } } },
        contact: true,
        activities: { orderBy: { occurredAt: "desc" }, take: 1, include: { user: { select: { name: true } } } },
        supplierPos: { include: { supplier: { select: { name: true } } } },
        deliveries: { select: { id: true } },
        invoices: { select: { id: true } },
      },
    }),
    loadReceivables({ deal: mineDeal }),
    db.delivery.findMany({ where: { invoice: null, deal: mineDeal }, include: { deal: { include: { account: true } }, lines: true } }),
    loadSupplierPayments({ executedAt: null }),
    manager ? loadCredit() : Promise.resolve([]),
    db.task.findMany({ where: { assigneeId: user.id, status: "OPEN", scheduledAt: { not: null }, dealId: { not: null } }, select: { dealId: true, title: true, scheduledAt: true } }),
    opts.agenda === false ? Promise.resolve({ connected: false as const, events: [] as OutlookEvent[], error: null as string | null }) : agendaFor(user),
  ]);

  const loc = i.es ? "es-CO" : "en-US";
  const rel = (d: Date) => {
    const n = daysBetween(now, d);
    if (n === 0) return t("hoy", "today");
    if (n === 1) return t("mañana", "tomorrow");
    if (n === -1) return t("ayer", "yesterday");
    return n > 0 ? t(`en ${n} d`, `in ${n} d`) : t(`hace ${-n} d`, `${-n} d ago`);
  };
  const person = (c: { firstName: string; lastName: string; title: string | null } | null | undefined) => (c ? `${c.firstName} ${c.lastName}${c.title ? `, ${c.title}` : ""}` : null);

  // ---------- Outlook: which accounts have a meeting soon ----------
  const meetingFor = (acc: { name: string; contacts: { email: string | null }[] }): OutlookEvent | undefined => {
    const emails = acc.contacts.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[];
    const domains = emails.map((e) => e.split("@")[1]);
    const name = strip(acc.name).toLowerCase();
    return agenda.events.find(
      (e) => !e.fromSolu && (e.attendees.some((a) => emails.includes(a) || domains.includes(a.split("@")[1])) || e.subject.toLowerCase().includes(name)),
    );
  };
  const meetingText = (e: OutlookEvent) => {
    const d = new Date(Date.UTC(e.start.getUTCFullYear(), e.start.getUTCMonth(), e.start.getUTCDate()));
    const isToday = daysBetween(now, new Date(e.start.getTime() - 5 * 3600e3)) === 0 || d.getTime() === now.getTime();
    return isToday ? t(`Tienes reunión hoy a las ${hhmm(e.start, loc)}: «${e.subject}».`, `You have a meeting today at ${hhmm(e.start, loc)}: "${e.subject}".`) : t(`Tienes reunión el ${i.dateShort(e.start)} a las ${hhmm(e.start, loc)}: «${e.subject}».`, `You have a meeting on ${i.dateShort(e.start)} at ${hhmm(e.start, loc)}: "${e.subject}".`);
  };

  type D = (typeof deals)[number];
  const lastChange = (d: D): Fact => {
    const a = d.activities[0];
    if (a) return { text: a.subject + (a.body ? ` — ${a.body.slice(0, 140)}` : ""), src: t(`${a.type === "EMAIL" ? "Correo" : a.type === "CALL" ? "Llamada" : a.type === "MEETING" ? "Reunión" : "Nota"} · ${i.dateShort(a.occurredAt)} · ${a.user.name}`, `${a.type.toLowerCase()} · ${i.dateShort(a.occurredAt)} · ${a.user.name}`) };
    const idle = daysBetween(d.updatedAt, new Date());
    return idle >= 2
      ? { text: t(`Nada nuevo en ${idle} días: ni correo, ni llamada, ni cambio en el Journey.`, `Nothing new in ${idle} days: no email, call or Journey change.`), src: t(`Última actualización ${i.date(d.updatedAt)}`, `Last update ${i.date(d.updatedAt)}`) }
      : { text: t("Sin hechos nuevos registrados desde la última actualización.", "No new facts recorded since the last update."), src: t(`Actualizado ${i.date(d.updatedAt)}`, `Updated ${i.date(d.updatedAt)}`) };
  };
  const dealImpact = (d: D): Fact => {
    const e = esagra(d);
    const parts = [i.money(d.amount)];
    if (Number(d.supplierCost) > 0 && e.pct != null) parts.push(t(`esagra ≈ ${i.money(e.value)} (${i.pct(e.pct)})`, `margin ≈ ${i.money(e.value)} (${i.pct(e.pct)})`));
    let text = t(`Está en juego ${parts.join(" · ")} en etapa ${stageLabel(i, d.stage)}.`, `${parts.join(" · ")} at stake, stage ${stageLabel(i, d.stage)}.`);
    if (d.promisedDate && d.promisedDate >= now) text += " " + t(`Le prometiste al cliente: «${d.promiseText ?? d.title}» para el ${i.dateShort(d.promisedDate)}.`, `You promised the customer "${d.promiseText ?? d.title}" by ${i.dateShort(d.promisedDate)}.`);
    else if (d.closeDate && d.closeDate >= now) text += " " + t(`El cliente decide hacia el ${i.dateShort(d.closeDate)}.`, `The customer decides around ${i.dateShort(d.closeDate)}.`);
    return { text, src: Number(d.supplierCost) > 0 ? t("Esagra calculada con los costos del Journey", "Margin calculated from the Journey costs") : undefined };
  };
  const whoDeal = (d: D) => ({
    title: strip(d.account.name),
    sub: [person(d.contact), `${d.code ? d.code + " · " : ""}${d.title}`].filter(Boolean).join(" · "),
  });
  const sched = (d: D, title: string) => {
    const s = scheduled.find((x) => x.dealId === d.id && x.title === title);
    return { dealId: d.id, title, minutes: 30, scheduledAt: s?.scheduledAt ?? null };
  };
  const withMeeting = (why: Fact, acc: D["account"]): Fact => {
    const m = meetingFor(acc);
    return m ? { text: `${why.text} ${meetingText(m)}`, src: [why.src, t("Calendario de Outlook", "Outlook calendar")].filter(Boolean).join(" · ") } : why;
  };

  const needs: Need[] = [];
  const controlled = new Set<string>();

  // 1. Broken payment promises: the result (cash) is at risk.
  for (const r of receivables) {
    if (r.state !== "BROKEN" || !r.promise) continue;
    const late = daysBetween(r.promise.promisedFor, now);
    const overdue = daysBetween(r.dueAt, now);
    needs.push({
      key: `p-${r.id}`,
      tone: "risk",
      rank: 0,
      at: r.promise.promisedFor.getTime(),
      due: { main: t(`vencida hace ${overdue} d`, `${overdue} d overdue`), sub: t(`promesa ${i.day(r.promise.promisedFor)}`, `promise ${i.day(r.promise.promisedFor)}`) },
      who: { title: strip(r.account.name), sub: `${r.promise.promisedBy} · ${t("factura", "invoice")} ${r.number}${r.deal ? ` · ${r.deal.code ?? r.deal.title}` : ""}` },
      why: { text: t(`La fecha que dio ${r.promise.promisedBy} pasó hace ${late} ${late === 1 ? "día" : "días"} y no hay pago registrado.`, `The date ${r.promise.promisedBy} gave passed ${late} day(s) ago and no payment is recorded.`) },
      changed: { text: t(`Prometió pagar el ${i.dateShort(r.promise.promisedFor)}; el pago no llegó.`, `Promised to pay on ${i.dateShort(r.promise.promisedFor)}; payment didn't arrive.`), src: r.promise.source },
      impact: { text: t(`${i.money(r.cash.balance)} sin cobrar, vencido desde el ${i.dateShort(r.dueAt)}. Si pasa de 90 días vencida, se pierde la mitad de la comisión que se gana al recaudo.`, `${i.money(r.cash.balance)} uncollected, due since ${i.dateShort(r.dueAt)}. Past 90 days overdue, the collection half of the commission is lost.`), src: t("Saldo de la factura · política de comisiones v1", "Invoice balance · commission policy v1") },
      next: t(`Llamar a ${r.promise.promisedBy.split(" (")[0]} y acordar una fecha nueva con un responsable.`, `Call ${r.promise.promisedBy.split(" (")[0]} and agree a new date with an owner.`),
      primary: { label: t("Preparar contacto", "Prepare contact"), href: `/administracion/cobrar?f=${r.id}` },
      context: `/administracion/cobrar?f=${r.id}`,
    });
  }

  // 2. Supplier payments that need independent verification / approval.
  for (const p of payments) {
    const promise = p.supplierPo.deal.promisedDate;
    const supplier = strip(p.supplierPo.supplier.name);
    const impact: Fact = {
      text: t(`${p.currency} ${i.n2(p.amount)} al proveedor.${promise ? ` Sin pago no despacha, y le prometiste a ${strip(p.supplierPo.deal.account.name)}: «${p.supplierPo.deal.promiseText ?? p.supplierPo.deal.title}» para el ${i.dateShort(promise)}.` : ""}`, `${p.currency} ${i.n2(p.amount)} to the supplier.${promise ? ` No payment, no shipment, and you promised ${strip(p.supplierPo.deal.account.name)} "${p.supplierPo.deal.promiseText ?? p.supplierPo.deal.title}" by ${i.dateShort(promise)}.` : ""}`),
      src: p.reason,
    };
    if (p.state === "VERIFY" && p.requestedById !== user.id) {
      needs.push({
        key: `v-${p.id}`, tone: "risk", rank: 1, at: p.dueBy?.getTime() ?? now.getTime(),
        due: { main: p.dueBy ? `${i.day(p.dueBy)}` : t("hoy", "today"), sub: p.dueBy ? rel(p.dueBy) : undefined },
        who: { title: `${supplier} ${t("(proveedor)", "(supplier)")}`, sub: `${p.supplierPo.code} · ${p.supplierPo.deal.code ?? ""}` },
        why: { text: t("El pago se necesita antes de que el proveedor despache, y los datos bancarios no coinciden con el perfil verificado.", "The payment is needed before the supplier ships, and the bank details don't match the verified profile.") },
        changed: (() => {
          const label = (f: string) => ({ beneficiary: t("beneficiario", "beneficiary"), bankName: t("banco", "bank"), account: t("cuenta", "account"), swift: "SWIFT" })[f] ?? f;
          const list = p.discrepancies.map((x) => label(x.field)).join(", ");
          return { text: t(`${p.discrepancies.length} ${p.discrepancies.length === 1 ? "dato distinto" : "datos distintos"} al perfil verificado: ${list}.`, `${p.discrepancies.length} field(s) differ from the verified profile: ${list}.`), src: p.docSource ?? undefined };
        })(),
        impact,
        next: t("Confirmar los datos llamando al teléfono registrado del proveedor, nunca al que venga en el correo.", "Confirm the details by calling the supplier's registered phone, never the one in the email."),
        primary: { label: t("Verificar", "Verify"), href: `/administracion/pagos-proveedores/${p.id}` },
        context: `/deals/${p.supplierPo.deal.id}`,
      });
    }
    if (manager && p.state === "APPROVE" && p.requestedById !== user.id && p.verifiedById !== user.id) {
      needs.push({
        key: `a-${p.id}`, tone: "move", rank: 2, at: p.dueBy?.getTime() ?? now.getTime(),
        due: { main: p.dueBy ? `${i.day(p.dueBy)}` : t("hoy", "today"), sub: p.dueBy ? rel(p.dueBy) : undefined },
        who: { title: `${supplier} ${t("(proveedor)", "(supplier)")}`, sub: `${p.supplierPo.code} · ${p.supplierPo.deal.code ?? ""}` },
        why: { text: t("Ya está verificado de forma independiente; solo falta tu aprobación para ejecutarlo.", "It's already independently verified; only your approval is missing.") },
        changed: { text: t(`Verificado por ${p.verifiedBy?.name ?? "—"}${p.verifiedAt ? ` el ${i.dateShort(p.verifiedAt)}` : ""}.`, `Verified by ${p.verifiedBy?.name ?? "—"}${p.verifiedAt ? ` on ${i.dateShort(p.verifiedAt)}` : ""}.`), src: p.verificationNote ?? undefined },
        impact,
        next: t("Revisar el motivo y aprobar o rechazar.", "Review the reason and approve or reject."),
        primary: { label: t("Revisar pago", "Review payment"), href: `/administracion/pagos-proveedores/${p.id}` },
        context: `/deals/${p.supplierPo.deal.id}`,
      });
    }
  }

  // 3. Credit limit decisions (management).
  for (const a of credit) {
    for (const d of a.blocking) {
      needs.push({
        key: `c-${d.id}`, tone: "move", rank: 2, at: d.promisedDate?.getTime() ?? now.getTime() + 864e5,
        due: { main: d.promisedDate ? i.day(d.promisedDate) : t("antes de despachar", "before shipping"), sub: d.promisedDate ? t("promesa al cliente", "customer promise") : undefined },
        who: { title: strip(a.name), sub: `${d.code ?? ""} · ${d.title}` },
        why: { text: t("El pedido está aceptado pero no puede despacharse mientras supere el cupo.", "The order is accepted but can't ship while it exceeds the credit limit.") },
        changed: { text: t(`Con este pedido el uso llega a ${i.money(a.used)} de un cupo de ${i.money(a.limit)}.`, `With this order usage reaches ${i.money(a.used)} of a ${i.money(a.limit)} limit.`), src: t(`${a.overdueCount} facturas vencidas`, `${a.overdueCount} overdue invoices`) },
        impact: { text: t(`${i.money(d.amount)} detenidos${d.promisedDate ? `; la entrega prometida es el ${i.dateShort(d.promisedDate)}` : ""}.`, `${i.money(d.amount)} on hold${d.promisedDate ? `; promised delivery ${i.dateShort(d.promisedDate)}` : ""}.`) },
        next: t("Decidir: excepción de gerencia, anticipo o esperar un pago pendiente.", "Decide: management exception, prepayment or wait for a pending payment."),
        primary: { label: t("Ver opciones", "See options"), href: `/administracion/cupos#${a.id}` },
        context: `/deals/${d.id}`,
      });
    }
  }

  // 4. Journeys: expired waits, due moves and Journeys without a next move.
  for (const d of deals) {
    const who = whoDeal(d);
    if (d.stage === "WON") {
      controlled.add(d.id); // accepted orders move through the derived chain
      continue;
    }
    if (d.waitingFor) {
      if (d.waitingUntil && d.waitingUntil < now) {
        const late = daysBetween(d.waitingUntil, now);
        const next = d.nextMove ?? t(`Pedir respuesta sobre «${d.waitingFor}» o decidir otro camino.`, `Ask for an answer on "${d.waitingFor}" or choose another path.`);
        needs.push({
          key: `w-${d.id}`, tone: "move", rank: 3, at: d.waitingUntil.getTime(),
          due: { main: t(`venció ${i.day(d.waitingUntil)}`, `expired ${i.day(d.waitingUntil)}`), sub: rel(d.waitingUntil) },
          who,
          why: withMeeting({ text: t(`Esperabas «${d.waitingFor}» hasta el ${i.dateShort(d.waitingUntil)}; lleva ${late} ${late === 1 ? "día" : "días"} vencida.`, `You were waiting for "${d.waitingFor}" until ${i.dateShort(d.waitingUntil)}; ${late} day(s) overdue.`) }, d.account),
          changed: lastChange(d),
          impact: dealImpact(d),
          next,
          primary: { label: t("Abrir Journey", "Open Journey"), href: `/deals/${d.id}` },
          context: `/deals/${d.id}`,
          schedule: sched(d, next),
        });
      } else controlled.add(d.id);
      continue;
    }
    if (d.nextMove) {
      if (!d.nextMoveDate || d.nextMoveDate <= now) {
        const late = d.nextMoveDate ? daysBetween(d.nextMoveDate, now) : 0;
        needs.push({
          key: `m-${d.id}`, tone: "move", rank: late > 0 ? 3 : 4, at: d.nextMoveDate?.getTime() ?? now.getTime(),
          due: late > 0 ? { main: t(`era ${i.day(d.nextMoveDate)}`, `was ${i.day(d.nextMoveDate)}`), sub: t(`${late} d de atraso`, `${late} d late`) } : { main: t("hoy", "today") },
          who,
          why: withMeeting({ text: late > 0 ? t(`Quedó para el ${i.dateShort(d.nextMoveDate)} y no se ha hecho; el cliente sigue sin noticias.`, `It was set for ${i.dateShort(d.nextMoveDate)} and hasn't happened; the customer has no news.`) : t("Es el movimiento que acordaste para hoy.", "It's the move you set for today.") }, d.account),
          changed: lastChange(d),
          impact: dealImpact(d),
          next: d.nextMove,
          primary: { label: t("Abrir Journey", "Open Journey"), href: `/deals/${d.id}` },
          context: `/deals/${d.id}`,
          schedule: sched(d, d.nextMove),
        });
      } else controlled.add(d.id);
      continue;
    }
    needs.push({
      key: `n-${d.id}`, tone: "clarity", rank: 5, at: now.getTime() + 864e5,
      due: { main: t("sin fecha", "no date") },
      who,
      why: withMeeting({ text: t("Nadie sabe qué sigue: el Journey no tiene siguiente movimiento ni una espera con control.", "Nobody knows what's next: the Journey has no next move or controlled wait.") }, d.account),
      changed: lastChange(d),
      impact: dealImpact(d),
      next: t("Definir el siguiente movimiento con fecha, o una espera con control.", "Set the next move with a date, or a controlled wait."),
      primary: { label: t("Definir", "Set"), href: `/deals/${d.id}` },
      context: `/deals/${d.id}`,
    });
  }

  // 5. Deliveries ready to invoice: every day not invoiced pushes collection back.
  for (const dl of deliveries) {
    if (invoiceBlockers(dl, dl.deal, dl.deal.account).length) continue;
    const days = daysBetween(dl.deliveredAt, now);
    needs.push({
      key: `inv-${dl.id}`, tone: "move", rank: 4, at: dl.deliveredAt.getTime(),
      due: { main: t(`entregado ${i.day(dl.deliveredAt)}`, `delivered ${i.day(dl.deliveredAt)}`), sub: rel(dl.deliveredAt) },
      who: { title: strip(dl.deal.account.name), sub: `${dl.code} · ${dl.deal.code ?? dl.deal.title}` },
      why: { text: t(`Se entregó hace ${days} ${days === 1 ? "día" : "días"} y ya tiene todo lo que pide el cliente para facturar.`, `Delivered ${days} day(s) ago and has everything the customer requires to invoice.`) },
      changed: { text: t("Remisión con soporte de entrega; sin bloqueos de facturación.", "Delivery note with proof of delivery; no invoicing blockers."), src: dl.code },
      impact: { text: t(`Cada día sin factura corre la fecha de cobro (plazo ${dl.deal.account.paymentTermsDays} días). La mitad de tu comisión se gana al facturar.`, `Each day without an invoice pushes collection back (${dl.deal.account.paymentTermsDays}-day terms). Half your commission is earned at invoicing.`) },
      next: t("Emitir la factura de lo entregado.", "Issue the invoice for what was delivered."),
      primary: { label: t("Emitir factura", "Issue invoice"), href: `/operaciones/por-facturar` },
      context: `/operaciones/remisiones/${dl.id}`,
    });
  }

  needs.sort((a, b) => a.rank - b.rank || a.at - b.at);

  // ---------- Futuro que vale la pena mover (≤ 21 days) ----------
  const future: FutureItem[] = [];
  for (const d of deals) {
    if (d.offerValidUntil && d.offerValidUntil >= now && d.offerValidUntil <= horizon && d.stage !== "WON") {
      future.push({ key: `o-${d.id}`, at: d.offerValidUntil, window: true, title: t(`Oferta a ${strip(d.account.name)} vence el ${i.day(d.offerValidUntil)}`, `Offer to ${strip(d.account.name)} expires ${i.day(d.offerValidUntil)}`), text: t(`${d.title} · ${i.money(d.amount)}. Hablar antes de la fecha permite renovarla en tus términos, no bajo presión.`, `${d.title} · ${i.money(d.amount)}. Talking before the date lets you renew on your terms, not under pressure.`), chip: t(`vence ${rel(d.offerValidUntil)}`, `expires ${rel(d.offerValidUntil)}`), link: { label: t("Preparar renovación", "Prepare renewal"), href: `/deals/${d.id}` } });
    }
    if (d.closeDate && d.closeDate > now && d.closeDate <= horizon && d.stage !== "WON") {
      future.push({ key: `cl-${d.id}`, at: d.closeDate, window: false, title: t(`${strip(d.account.name)} decide hacia el ${i.day(d.closeDate)}`, `${strip(d.account.name)} decides around ${i.day(d.closeDate)}`), text: t(`${d.title}: confirmar ahora quién decide y qué necesita ver evita perder la decisión por silencio.`, `${d.title}: confirming now who decides and what they need avoids losing it to silence.`), chip: rel(d.closeDate), link: { label: t("Abrir Journey", "Open Journey"), href: `/deals/${d.id}` } });
    }
    if (d.stage === "WON" && d.promisedDate && d.promisedDate >= now && d.promisedDate <= horizon) {
      const unconfirmed = d.supplierPos.find((s) => !s.confirmedAt);
      const late = d.supplierPos.find((s) => s.eta && !s.receivedAt && s.eta > d.promisedDate!);
      const none = d.supplierPos.length === 0;
      if (unconfirmed || late || none) {
        future.push({
          key: `pr-${d.id}`, at: d.promisedDate, window: true,
          title: t(`Promesa a ${strip(d.account.name)}: ${i.day(d.promisedDate)}`, `Promise to ${strip(d.account.name)}: ${i.day(d.promisedDate)}`),
          text: none ? t(`«${d.promiseText ?? d.title}» y aún no hay compra al proveedor. Comprar hoy protege la fecha.`, `"${d.promiseText ?? d.title}" and there's no supplier purchase yet. Buying today protects the date.`) : late ? t(`${strip(late.supplier.name)} llega el ${i.day(late.eta)}, después de lo prometido. Avisar antes conserva la confianza.`, `${strip(late.supplier.name)} arrives ${i.day(late.eta)}, after the promise. Warning early keeps trust.`) : t(`${strip(unconfirmed!.supplier.name)} no ha confirmado la orden ${unconfirmed!.code}.`, `${strip(unconfirmed!.supplier.name)} hasn't confirmed order ${unconfirmed!.code}.`),
          chip: t(`ventana hasta ${i.day(d.promisedDate)}`, `window until ${i.day(d.promisedDate)}`),
          link: { label: none ? t("Crear Supplier PO", "Create Supplier PO") : t("Ver cadena", "See chain"), href: `/deals/${d.id}` },
        });
      }
    }
  }
  future.sort((a, b) => a.at.getTime() - b.at.getTime());

  // ---------- Esperando con control ----------
  const waits: WaitItem[] = [];
  for (const d of deals) {
    if (d.waitingFor && d.waitingUntil && d.waitingUntil >= now) {
      waits.push({ key: `w-${d.id}`, what: d.waitingFor, from: `${strip(d.account.name)}${d.code ? ` · ${d.code}` : ""}`, until: d.waitingUntil, trigger: t(`Si no llega el ${i.day(d.waitingUntil)}, SOLU lo sube a «Necesita de ti».`, `If it hasn't arrived by ${i.day(d.waitingUntil)}, SOLU moves it to "Needs you".`), href: `/deals/${d.id}` });
    }
    for (const s of d.supplierPos) {
      if (s.shippedAt && !s.receivedAt && s.eta && s.eta >= now) {
        waits.push({ key: `s-${s.id}`, what: t("Llegada a bodega", "Arrival at warehouse"), from: `${strip(s.supplier.name)} · ${s.code}`, until: s.eta, trigger: d.promisedDate ? t(`Si se retrasa, SOLU reevalúa la promesa del ${i.day(d.promisedDate)}.`, `If it slips, SOLU re-evaluates the ${i.day(d.promisedDate)} promise.`) : t("Si se retrasa, SOLU te avisa.", "If it slips, SOLU tells you."), href: `/deals/${d.id}` });
      }
    }
  }
  for (const r of receivables) {
    if (r.state === "WAITING" && r.promise) {
      waits.push({ key: `r-${r.id}`, what: t(`Pago de ${i.money(r.cash.balance)}`, `Payment of ${i.money(r.cash.balance)}`), from: `${strip(r.account.name)} · ${r.promise.promisedBy}`, until: r.promise.promisedFor, trigger: t("Si no llega en la fecha, pasa a «Compromiso incumplido».", "If it doesn't arrive on the date, it becomes \"Commitment missed\"."), href: `/administracion/cobrar?f=${r.id}` });
    }
  }
  waits.sort((a, b) => a.until.getTime() - b.until.getTime());
  const waitingDeals = new Set(waits.filter((w) => w.key.startsWith("w-")).map((w) => w.key.slice(2)));
  const normal = [...controlled].filter((id) => !waitingDeals.has(id)).length;

  // ---------- Señales (≤ 3, only if they change how you negotiate) ----------
  const signals: Signal[] = [];
  const openAccounts = new Map<string, D["account"]>();
  for (const d of deals) if (d.stage !== "WON") openAccounts.set(d.accountId, d.account);
  for (const [id, acc] of openAccounts) {
    const m = meetingFor(acc);
    if (m && signals.length < 3) signals.push({ key: `mt-${id}`, title: t(`Reunión con ${strip(acc.name)} ${rel(new Date(Date.UTC(m.start.getUTCFullYear(), m.start.getUTCMonth(), m.start.getUTCDate())))} a las ${hhmm(m.start, loc)}`, `Meeting with ${strip(acc.name)} ${rel(new Date(Date.UTC(m.start.getUTCFullYear(), m.start.getUTCMonth(), m.start.getUTCDate())))} at ${hhmm(m.start, loc)}`), text: t(`«${m.subject}». Llega con el estado de sus Journeys y facturas abiertas.`, `"${m.subject}". Go in knowing their open Journeys and invoices.`), src: t("Calendario de Outlook", "Outlook calendar"), href: m.webLink || undefined });
  }
  const overdueBy = new Map<string, { name: string; n: number; total: number }>();
  for (const r of receivables) {
    if (r.dueAt < now && openAccounts.has(r.account.id)) {
      const x = overdueBy.get(r.account.id) ?? { name: r.account.name, n: 0, total: 0 };
      x.n++; x.total += r.cash.balance;
      overdueBy.set(r.account.id, x);
    }
  }
  for (const [id, x] of overdueBy) {
    if (signals.length >= 3) break;
    signals.push({ key: `od-${id}`, title: t(`${strip(x.name)} tiene ${x.n} ${x.n === 1 ? "factura vencida" : "facturas vencidas"} mientras negocias`, `${strip(x.name)} has ${x.n} overdue invoice(s) while you negotiate`), text: t(`${i.money(x.total)} sin pagar. Conviene acordar el pago antes de comprometer plazo o descuento nuevos.`, `${i.money(x.total)} unpaid. Agree payment before committing new terms or discounts.`), src: t("Cuentas por cobrar", "Receivables"), href: `/accounts/${id}` });
  }
  if (signals.length < 3) {
    const won = await db.deal.groupBy({ by: ["accountId"], where: { ownerId: user.id, stage: "WON", poAcceptedAt: { gte: addDays(now, -90) } }, _count: true });
    for (const g of won.filter((x) => x._count >= 3)) {
      if (signals.length >= 3) break;
      const acc = await db.account.findUnique({ where: { id: g.accountId }, select: { name: true } });
      signals.push({ key: `rec-${g.accountId}`, inferred: true, title: t(`Posible acuerdo de suministro con ${strip(acc?.name ?? "")}`, `Possible supply agreement with ${strip(acc?.name ?? "")}`), text: t(`${g._count} órdenes en 90 días: un acuerdo o stock en consignación evitaría la próxima urgencia.`, `${g._count} orders in 90 days: an agreement or consignment stock would avoid the next urgency.`), src: t(`Inferencia de SOLU · regla simple: ${g._count} órdenes en 90 días`, `SOLU inference · simple rule: ${g._count} orders in 90 days`), href: `/accounts/${g.accountId}` });
    }
  }

  // ---------- Agenda line ----------
  const dayEnd = new Date(now.getTime() + 29 * 3600e3);
  const todayEvents = agenda.events.filter((e) => !e.isAllDay && e.start < dayEnd && e.end > new Date());
  const nextMeeting = todayEvents.find((e) => !e.fromSolu);

  return {
    needs: needs.slice(0, MAX_NEEDS),
    moreNeeds: needs.slice(MAX_NEEDS),
    needCount: needs.length,
    controlledCount: controlled.size,
    normal,
    future: future.slice(0, 4),
    waits,
    signals,
    agenda: { connected: agenda.connected, error: agenda.error, todayCount: todayEvents.filter((e) => !e.fromSolu).length, next: nextMeeting ? { time: hhmm(nextMeeting.start, loc), subject: nextMeeting.subject } : null },
    now,
  };
}
