import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, dayInput, today } from "@/lib/domain";
import { MEETING_KINDS, checkpointsOf, mayGuide } from "@/lib/team-rules";
import { getTeamPolicy, relationTo, viewablePeople } from "@/lib/team-store";
import { Notes, PersonSwitch, tOf } from "../ui";
import { scheduleMeeting } from "../actions";

// Módulo 16 §6 · Development conversations: 1:1, mentoring, 30/60/90 checkpoints, performance, career, succession
// and feedback. A conversation belongs to the two people in it. Its agenda is built from what is already known.

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; p?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const sp = await searchParams;
  const T = today();
  const people = await viewablePeople(user);
  const personId = sp.p && people.some((p) => p.id === sp.p) ? sp.p : user.id;
  const self = personId === user.id;
  const rel = await relationTo(user, personId);
  const [mine, everyone, plan, pol] = await Promise.all([
    // Every conversation this viewer takes part in; when looking at one person, only those with that person.
    db.developmentMeeting.findMany({ where: { scheduledOn: { gte: addDays(T, -180) }, ...(self ? { OR: [{ userId: user.id }, { withId: user.id }] } : { userId: personId, withId: user.id }) }, orderBy: { scheduledOn: "asc" }, take: 120, include: { user: { select: { id: true, name: true } }, with: { select: { id: true, name: true } } } }),
    db.user.findMany({ where: { active: true, role: { not: "JUNTA" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.developmentPlan.findFirst({ where: { userId: personId, status: "ACTIVE" }, select: { id: true, startsOn: true, leaderId: true, mentorId: true } }),
    getTeamPolicy(),
  ]);
  const planned = mine.filter((m) => m.status === "PLANNED"), past = mine.filter((m) => m.status !== "PLANNED").reverse();
  const toClose = planned.filter((m) => m.scheduledOn <= T);
  const cps = plan ? checkpointsOf(plan.startsOn, pol.value) : [];
  const other = (m: (typeof mine)[number]) => (m.userId === user.id ? m.with.name : m.user.name);
  const ok = {};
  const err = {
    permiso: t("Las conversaciones de desarrollo las programan la persona o quien la acompaña.", "Development conversations are scheduled by the person or whoever accompanies them."),
    reunion: t("Faltan datos: tipo, fecha y con quién. No se guardó nada.", "Missing data: kind, date and with whom. Nothing was saved."),
    checkpoint: t("Un punto de control necesita un ciclo abierto y uno de los días del ciclo.", "A checkpoint needs an open cycle and one of the days of the cycle."),
  };

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Conversaciones de desarrollo", "Development conversations")}</h1>
        <p>{t("Cada conversación llega con su agenda armada: compromisos pendientes, evidencia nueva y foco actual. Al cerrarla queda programada la siguiente.", "Each conversation arrives with its agenda built: pending commitments, new evidence and current focus. Closing it leaves the next one scheduled.")}</p>
      </div><span className="grow" /><PersonSwitch people={people} current={personId} me={user.id} path="/equipo/reuniones" i={i} /></div>
      <Notes sp={sp} ok={ok} err={err} />

      {toClose.length > 0 && <div className="note attn">{t("Conversaciones cuya fecha ya llegó y siguen abiertas:", "Conversations whose date has come and are still open:")} {toClose.map((m) => <Link key={m.id} href={`/equipo/reuniones/${m.id}`} style={{ marginRight: 12 }}>{i.day(m.scheduledOn)} · {other(m)}</Link>)}</div>}

      <section className="card" id="proximas"><b>{t("PRÓXIMAS", "UPCOMING")}</b>
        {planned.length === 0 ? <p className="small muted">{t("Ninguna programada.", "None scheduled.")} <a href="#nueva">{t("Programar una conversación", "Schedule a conversation")} →</a></p> : (
          <div className="tscroll"><table>
            <thead><tr><th>{t("Cuándo", "When")}</th><th>{t("Tipo", "Kind")}</th><th>{t("Sobre el desarrollo de", "About the development of")}</th><th>{t("Con", "With")}</th></tr></thead>
            <tbody>{planned.map((m) => <tr key={m.id}><td className={m.scheduledOn < T ? "attn-t" : ""}><Link href={`/equipo/reuniones/${m.id}`}>{i.dateShort(m.scheduledOn)}</Link></td><td>{tx(MEETING_KINDS[m.kind] ?? MEETING_KINDS.ONE_ON_ONE)}{m.checkpointDay != null ? ` · ${t("día", "day")} ${m.checkpointDay}` : ""}</td><td>{m.user.name}</td><td>{m.with.name}</td></tr>)}</tbody>
          </table></div>
        )}
      </section>

      {mayGuide(rel) && (
        <section className="card" id="nueva"><b>{t("PROGRAMAR UNA CONVERSACIÓN", "SCHEDULE A CONVERSATION")}</b> {!self ? <span className="small muted">{t(`sobre el desarrollo de ${people.find((p) => p.id === personId)?.name ?? ""}, contigo`, `about ${people.find((p) => p.id === personId)?.name ?? ""}'s development, with you`)}</span> : null}
          <form action={scheduleMeeting.bind(null, personId)} className="qa-form">
            <div className="qa-row">
              <label>{t("Tipo", "Kind")}<select name="kind" defaultValue="ONE_ON_ONE">{Object.entries(MEETING_KINDS).map(([k, x]) => <option key={k} value={k}>{tx(x)}</option>)}</select></label>
              <label>{t("Fecha", "Date")}<input type="date" name="scheduledOn" required min={dayInput(addDays(T, -30))} defaultValue={dayInput(T)} /></label>
              {self ? <label>{t("Con quién", "With whom")}<select name="withId" required defaultValue={plan?.leaderId ?? plan?.mentorId ?? ""}><option value="" disabled>—</option>{everyone.filter((x) => x.id !== user.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label> : null}
              {cps.length > 0 && <label>{t("Si es punto de control, cuál", "If a checkpoint, which")}<select name="checkpointDay" defaultValue={String(cps.find((c) => c.on >= T)?.day ?? cps[cps.length - 1].day)}>{cps.map((c) => <option key={c.day} value={c.day}>{t("día", "day")} {c.day} · {i.day(c.on)}</option>)}</select></label>}
            </div>
            <div><button type="submit" className="secondary">{t("Programar", "Schedule")}</button></div>
          </form>
        </section>
      )}

      <section className="card" id="pasadas"><b>{t("REALIZADAS Y CANCELADAS", "HELD AND CANCELLED")}</b> <span className="small muted">{t("últimos 180 días", "last 180 days")}</span>
        {past.length === 0 ? <p className="small muted">{t("Ninguna.", "None.")}</p> : (
          <ul className="plain">{past.map((m) => <li key={m.id}><span className={`sig ${m.status === "HELD" ? "ok" : "wait"}`}>{m.status === "HELD" ? t("realizada", "held") : t("cancelada", "cancelled")}</span> <Link href={`/equipo/reuniones/${m.id}`}>{i.date(m.heldOn ?? m.scheduledOn)}</Link> · {tx(MEETING_KINDS[m.kind] ?? MEETING_KINDS.ONE_ON_ONE)} · {m.user.name} {t("con", "with")} {m.with.name}</li>)}</ul>
        )}
      </section>
    </div>
  );
}
