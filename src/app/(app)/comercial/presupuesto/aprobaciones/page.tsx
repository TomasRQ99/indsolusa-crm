import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { PROSPECTS, shownState, sum } from "@/lib/sales-budget-rules";
import { approverIdsOf, budgetScope, budgetYears, budgetsOf, groupVersions, matrixOf, readYear, yearRow, type BudgetRow } from "@/lib/sales-budget";
import { BudgetNav, StateChip, budgetFmt } from "../ui";
import "../presupuesto.css";

// Presupuesto comercial · P06 Aprobaciones (spec §5, §6): what waits for my decision, where my own proposals stand,
// every proposal in my view with its version and state, and the trail of who did what. Nothing is decided here: each
// line opens the proposal, where the figures are in front of whoever decides.

const EVENT: Record<string, { es: string; en: string }> = {
  CREATED: { es: "creó el borrador", en: "created the draft" }, SAVED: { es: "cambió las cifras", en: "changed the figures" }, SUBMITTED: { es: "envió a aprobación", en: "sent for approval" },
  WITHDRAWN: { es: "retiró el envío", en: "withdrew the submission" }, RETURNED: { es: "devolvió", en: "returned" }, APPROVED: { es: "aprobó", en: "approved" },
  NEW_VERSION: { es: "abrió una versión nueva", en: "opened a new version" }, RECONCILE: { es: "pidió conciliación", en: "asked for reconciliation" },
};

export default async function BudgetApprovals({ searchParams }: { searchParams: Promise<{ y?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const f = budgetFmt(i);
  const sp = await searchParams;
  const now = new Date();
  const year = readYear(sp.y, now);
  const { years } = budgetYears(now);
  const scope = await budgetScope(user);
  // Whoever approves must see what waits for them even outside their usual view, so the read is by year.
  const [all, yr] = await Promise.all([budgetsOf(year), yearRow(year)]);
  const published = !!yr?.publishedAt;
  const groups = [...groupVersions(all).values()];
  const owners = [...new Set(groups.map((g) => g.latest.userId))];
  const approversOf = new Map(await Promise.all(owners.map(async (id) => [id, await approverIdsOf(id)] as const)));
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set([...approversOf.values()].flatMap((a) => a.ids))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const whoApproves = (b: BudgetRow) => (approversOf.get(b.userId)?.ids ?? []).map((id) => names.get(id)).filter(Boolean).join(", ") || t("nadie asignado", "nobody assigned");

  const waiting = groups.filter((g) => g.latest.state === "SUBMITTED" && approversOf.get(g.latest.userId)?.ids.includes(user.id)).map((g) => g.latest).sort((a, b) => +(a.submittedAt ?? 0) - +(b.submittedAt ?? 0));
  const mine = groups.filter((g) => g.latest.userId === user.id).map((g) => g.latest);
  const visible = groups.filter((g) => scope.all || scope.ids.has(g.latest.userId) || approversOf.get(g.latest.userId)?.ids.includes(user.id));
  const order = ["SUBMITTED", "RETURNED", "DRAFT", "APPROVED"];
  const view = visible.map((g) => g.latest).sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.user.name.localeCompare(b.user.name, "es") || (a.account?.name ?? "~").localeCompare(b.account?.name ?? "~", "es"));
  const events = visible.length ? await db.salesBudgetEvent.findMany({ where: { budget: { year, id: { in: visible.flatMap((g) => g.all.map((b) => b.id)) } } }, orderBy: { at: "desc" }, take: 40, include: { budget: { select: { slot: true, userId: true, version: true, account: { select: { name: true } }, user: { select: { name: true } } } } } }) : [];

  const nameOf = (b: { slot: string; account: { name: string } | null }) => (b.slot === PROSPECTS ? t("Reactivaciones y prospectos", "Reactivations and prospects") : b.account?.name ?? "—");
  const open = (b: { slot: string; userId: string }) => `/comercial/presupuesto/${b.slot === PROSPECTS ? "prospectos" : b.slot}?y=${year}&u=${b.userId}`;
  const H = { neg: t("Negociador", "Negotiator"), ver: t("Versión", "Version"), st: t("Estado", "State"), oc: t("OC anual", "Annual POs"), fa: t("Facturación anual", "Annual invoicing"), es: t("Eságara anual", "Annual Eságara"), sent: t("Enviado", "Submitted"), who: t("Quién decide / decidió", "Who decides / decided") };
  const Row = ({ b, cta }: { b: BudgetRow; cta: string }) => { const m = matrixOf(b); return (
    <tr data-b={b.id}>
      <th scope="row"><Link href={open(b)}>{nameOf(b)}</Link></th>
      <td className="l" data-l={H.neg}>{b.user.name}</td>
      <td data-l={H.ver}>v{b.version}</td>
      <td className="l" data-l={H.st}><StateChip i={i} state={shownState(b, published)} /></td>
      <td data-l={H.oc}>{f.m(sum(m.OC_COP))}</td>
      <td data-l={H.fa}>{f.m(sum(m.FACT_COP))}</td>
      <td data-l={H.es}>{f.m(sum(m.ESA_COP))}</td>
      <td data-l={H.sent}>{b.submittedAt ? i.day(b.submittedAt) : "—"}</td>
      <td className="l" data-l={H.who} style={{ whiteSpace: "normal" }}>{b.decidedByName ? `${b.decidedByName} · ${i.day(b.decidedAt)}${b.decisionNote ? ` · «${b.decisionNote}»` : ""}` : whoApproves(b)}</td>
      <td><Link className="btn secondary" href={`${open(b)}#aprobacion`}>{cta} →</Link></td>
    </tr>
  ); };
  const Table = ({ id, rows, cta }: { id: string; rows: BudgetRow[]; cta: string }) => (
    <div className="pc-scroll">
      <table className="pc-table pc-cards" id={id}>
        <thead><tr><th>{t("Empresa", "Company")}</th><th className="l">{H.neg}</th><th>{H.ver}</th><th className="l">{H.st}</th><th>{H.oc}</th><th>{H.fa}</th><th>{H.es}</th><th>{H.sent}</th><th className="l">{H.who}</th><th /></tr></thead>
        <tbody>{rows.map((b) => <Row key={b.id} b={b} cta={cta} />)}</tbody>
      </table>
    </div>
  );

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href={`/comercial/presupuesto?y=${year}`}>{t(`Presupuesto comercial ${year}`, `Commercial budget ${year}`)}</Link></div>
        <h1>{t(`Aprobaciones del presupuesto ${year}`, `Budget approvals ${year}`)}</h1>
        <p>{t("El negociador envía su propuesta por empresa; su líder asignado la aprueba o la devuelve con el motivo. Lo aprobado queda bloqueado: corregirlo es abrir una versión nueva. Aquí ves qué espera tu decisión y en qué va cada propuesta.", "The negotiator sends their proposal per company; their assigned leader approves it or returns it with the reason. What is approved is locked: correcting it means opening a new version. Here you see what waits for your decision and where each proposal stands.")}</p>
      </div></div>
      <BudgetNav i={i} active="aprobaciones" year={year} years={years} />

      <section className="card" id="por-decidir">
        <b>{t("ESPERAN TU DECISIÓN", "WAITING FOR YOUR DECISION")}</b> <span className={`sig ${waiting.length ? "attn" : "ok"}`}>{waiting.length || t("Nada pendiente", "Nothing pending")}</span>
        {waiting.length === 0 ? <p className="small muted">{t("Ninguna propuesta espera tu aprobación. Cuando una persona que lideras envíe la suya, aparece aquí.", "No proposal is waiting for your approval. When someone you lead sends theirs, it shows here.")}</p> : <Table id="tabla-decidir" rows={waiting} cta={t("Abrir y decidir", "Open and decide")} />}
      </section>

      <section className="card" id="mias">
        <b>{t("TUS PROPUESTAS", "YOUR PROPOSALS")}</b>
        {mine.length === 0 ? <p className="small muted">{t("Aún no has guardado ninguna propuesta para este año.", "You haven't saved a proposal for this year yet.")} <Link href={`/comercial/presupuesto?y=${year}`}>{t("Ir a Mis empresas", "Go to My companies")} →</Link></p> : <Table id="tabla-mias" rows={mine.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))} cta={t("Abrir", "Open")} />}
      </section>

      {view.some((b) => b.userId !== user.id) && (
        <section className="card" id="todas">
          <b>{t("TODAS LAS PROPUESTAS A TU VISTA", "EVERY PROPOSAL IN YOUR VIEW")}</b>
          <Table id="tabla-todas" rows={view} cta={t("Abrir", "Open")} />
        </section>
      )}

      <section className="card" id="movimientos">
        <b>{t("ÚLTIMOS MOVIMIENTOS", "LATEST MOVEMENTS")}</b>
        {events.length === 0 ? <p className="small muted">{t("Todavía no hay movimientos.", "No movements yet.")}</p> : (
          <ul className="pc-events">
            {events.map((e) => <li key={e.id}><b>{e.byName}</b> {t(EVENT[e.kind]?.es ?? e.kind, EVENT[e.kind]?.en ?? e.kind)} · <Link href={open(e.budget)}>{nameOf(e.budget)}</Link> · {e.budget.user.name} · v{e.budget.version} · {i.date(e.at)}{e.note ? <> · «{e.note}»</> : null}</li>)}
          </ul>
        )}
        <p className="src">{t("Los 40 movimientos más recientes. Cada propuesta guarda su historia completa en su propia pantalla.", "The 40 most recent movements. Each proposal keeps its full history on its own screen.")}</p>
      </section>
    </>
  );
}
