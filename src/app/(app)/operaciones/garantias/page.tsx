import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { today } from "@/lib/domain";
import { getOpsPolicy } from "@/lib/ops-home";
import { CLAIM_KINDS, warrantyState } from "@/lib/warranty-rules";

// Operaciones O9d · open customer cases and warranties about to end, across Journeys.

export default async function WarrantiesPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const T = today();
  const endingDays = (await getOpsPolicy()).value.warrantyEndingDays;
  const [claims, warranties] = await Promise.all([
    db.customerClaim.findMany({ where: { status: "OPEN" }, orderBy: { reportedAt: "asc" }, include: { deal: { select: { id: true, code: true, title: true, account: { select: { name: true } } } }, _count: { select: { notes: true } } } }),
    db.warranty.findMany({ orderBy: { startsOn: "desc" }, take: 300, include: { deal: { select: { id: true, code: true, title: true, account: { select: { name: true } } } } } }),
  ]);
  const active = warranties.map((w) => ({ w, s: warrantyState(w.startsOn, w.months, T) })).filter((x) => x.s.active).sort((a, b) => a.s.daysLeft - b.s.daysLeft);
  const ending = active.filter((x) => x.s.daysLeft <= endingDays);

  return (
    <>
      <div className="ph"><div><h1>{t("Garantías y reclamos", "Warranties and claims")}</h1><p>{t("Los casos abiertos de clientes y las garantías vigentes. Se registran desde cada Journey.", "Open customer cases and active warranties. They are recorded from each Journey.")}</p></div></div>
      <section className="card">
        <b>{t("CASOS ABIERTOS", "OPEN CASES")} · {claims.length}</b>
        {claims.length === 0 ? <p className="small muted"><span className="sig ok">{t("Ningún caso abierto", "No open cases")}</span> {t("Un caso nuevo se registra en la pestaña de garantía del Journey del cliente.", "A new case is recorded on the warranty tab of the customer's Journey.")} <Link href="/deals">{t("Abrir Journeys", "Open Journeys")} →</Link></p> : (
          <ul className="plain small">{claims.map((c) => <li key={c.id}><Link href={`/deals/${c.deal.id}/garantia#c-${c.id}`}><b className="mono">{c.code}</b></Link> · {t(CLAIM_KINDS[c.kind]?.es ?? c.kind, CLAIM_KINDS[c.kind]?.en ?? c.kind)} · {c.deal.account.name} · {c.whatHappened.slice(0, 120)}<span className="muted"> · {t(`${Math.max(0, Math.floor((+T - +c.reportedAt) / 864e5))} días abierto`, `${Math.max(0, Math.floor((+T - +c.reportedAt) / 864e5))} days open`)} · {t(`${c._count.notes} notas`, `${c._count.notes} notes`)}</span></li>)}</ul>
        )}
      </section>
      <section className="card">
        <b>{t(`GARANTÍAS QUE TERMINAN EN ${endingDays} DÍAS`, `WARRANTIES ENDING WITHIN ${endingDays} DAYS`)} · {ending.length}</b>
        {ending.length === 0 ? <p className="small muted"><span className="sig ok">{t("Ninguna por ahora.", "None for now.")}</span></p> : (
          <ul className="plain small">{ending.map(({ w, s }) => <li key={w.id}><Link href={`/deals/${w.deal.id}/garantia`}>{w.deal.code ?? w.deal.title}</Link> · {w.deal.account.name} · {w.item}{w.serial ? ` · ${w.serial}` : ""} · <span className="mono">{i.day(s.end)}</span> <span className="muted">({t(`${s.daysLeft} días`, `${s.daysLeft} days`)})</span></li>)}</ul>
        )}
        <p className="src">{t(`${active.length} garantías vigentes en total. Una garantía que termina puede ser una buena razón para volver a hablar con el cliente.`, `${active.length} active warranties in total. A warranty about to end can be a good reason to talk to the customer again.`)}</p>
      </section>
    </>
  );
}
