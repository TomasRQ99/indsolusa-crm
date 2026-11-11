import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { DEV_FLAG, DIMS, type Dim } from "@/lib/team-rules";
import { teamDevView } from "@/lib/team-views";
import { tOf } from "../ui";

// Módulo 16 §13 · My Team Development: person, focus, last and next 1:1, commitments, attention. It shows what each
// person shared about their development and nothing of their 360: a private reflection, a test or a personal story
// cannot appear here, because this screen never reads them (AC8).

export default async function MyTeamPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const v = await teamDevView(user);
  const need = v.rows.filter((r) => r.flags.length > 0);

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Desarrollo de mi equipo", "My team's development")}</h1>
        <p>{v.rows.length === 0 ? t("Aquí aparecen las personas que acompañas como líder formal o como líder de un equipo.", "The people you accompany as formal leader or as leader of a team show here.") : need.length === 0 ? t("Cada persona tiene su ciclo en curso y su próxima conversación programada.", "Every person has a cycle in course and a next conversation scheduled.") : t(`${need.length} de ${v.rows.length} persona(s) tienen algo que pide tu atención.`, `${need.length} of ${v.rows.length} person(s) have something that asks for your attention.`)}</p>
        <p className="small">{t("calculado", "as of")} {i.date(v.asOf)}</p>
      </div></div>

      {v.rows.length === 0 ? (
        <div className="note">{t("Hoy no acompañas a nadie. El líder formal de cada persona se registra en Equipo → Claridad de roles o en Administración → Personas; los equipos, en Informes → Equipo.", "You accompany nobody today. Each person's formal leader is recorded in Team → Role clarity or in Administration → People; teams, in Reports → Team.")}</div>
      ) : (
        <section className="card flush">
          <div className="tscroll"><table>
            <thead><tr><th>{t("Persona", "Person")}</th><th>{t("Foco actual", "Current focus")}</th><th>{t("Última conversación", "Last conversation")}</th><th>{t("Próxima", "Next")}</th><th className="n">{t("Compromisos", "Commitments")}</th><th>{t("Atención", "Attention")}</th></tr></thead>
            <tbody>{v.rows.map((r) => (
              <tr key={r.id} id={`p-${r.id}`}>
                <td><Link href={`/equipo/desarrollo?p=${r.id}`}><b>{r.name}</b></Link><span className="src block">{r.title ?? t("sin acuerdo de rol", "no role agreement")}{r.plan ? ` · ${t("ciclo", "cycle")} ${r.plan.cycle} ${t("hasta", "until")} ${i.day(r.plan.endsOn)}` : ""}</span></td>
                <td className="small">{r.focus.length === 0 ? <span className="muted">{r.plan ? t("sin objetivos compartidos", "no shared objectives") : "—"}</span> : r.focus.map((o) => <span key={o.id} className="block"><span className="sig info">{tx(DIMS[o.dimension as Dim] ?? DIMS.SER)}</span> {o.title}</span>)}</td>
                <td className="small">{r.last ? i.day(r.last) : <span className="muted">{t("ninguna contigo", "none with you")}</span>}</td>
                <td className="small">{r.next ? i.day(r.next) : <Link href={`/equipo/reuniones?p=${r.id}#nueva`}>{t("programar", "schedule")}</Link>}</td>
                <td className="n mono">{r.commitments || "—"}{r.overdue ? <span className="src block attn-t">{t(`${r.overdue} vencido(s)`, `${r.overdue} overdue`)}{r.mineOverdue ? t(` · ${r.mineOverdue} tuyo(s)`, ` · ${r.mineOverdue} yours`) : ""}</span> : null}</td>
                <td className="small">{r.flags.length === 0 ? <span className="sig ok">{t("al día", "up to date")}</span> : r.flags.map((f, k) => <span key={k} className="block"><span className="sig attn">{tx(DEV_FLAG[f.key])}</span>{f.key === "UNDER_MIN" && f.dim ? ` ${tx(DIMS[f.dim])}` : f.key === "CHECKPOINT_DUE" ? ` ${t("día", "day")} ${f.day}` : ""}</span>)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
      <p className="src">{t("En orden alfabético: no es una clasificación. Ves los objetivos que cada persona compartió; sus reflexiones privadas, sus assessments y su historia personal no se leen para esta pantalla.", "In alphabetical order: not a ranking. You see the objectives each person shared; their private reflections, assessments and personal story are not read for this screen.")} <Link href="/equipo/claridad">{t("Claridad de roles", "Role clarity")}</Link> · <Link href="/equipo/feedback#equipo">{t("Feedback", "Feedback")}</Link></p>
    </div>
  );
}
