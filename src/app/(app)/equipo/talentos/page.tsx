import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { PROFILE_BLOCKS } from "@/lib/team-rules";
import { talentView } from "@/lib/team-views";
import { tOf } from "../ui";

// Módulo 16 §9 · Team Talent Map: what the team is made of, where people complement each other and where a piece
// of knowledge sits with one person. It reads only what each person chose to make organisational. It describes the
// team; it never labels a person.

export default async function TalentMapPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const tx = tOf(i);
  const v = await talentView(user);
  const blocks = ["TALENT", "HACER", "TENER"] as const;
  const empty = v.groups.length === 0;

  return (
    <div className="eq">
      <div className="ph"><div>
        <h1>{t("Mapa de talentos del equipo", "Team talent map")}</h1>
        <p>{t("De qué está hecho el equipo, dónde se complementa y dónde un conocimiento depende de una sola persona.", "What the team is made of, where it complements itself and where a piece of knowledge depends on one person.")}</p>
        <p className="small">{v.all ? t("Toda la organización", "The whole organisation") : t(`Las ${v.scope ?? 0} persona(s) que acompañas`, `The ${v.scope ?? 0} person(s) you accompany`)} · {t(`${v.people} persona(s) con algo organizacional en su perfil`, `${v.people} person(s) with something organisational in their profile`)} · {t("calculado", "as of")} {i.date(v.asOf)}</p>
      </div></div>

      {empty ? <div className="note">{!v.all && !v.scope ? t("Aquí ves el mapa de las personas que acompañas como líder.", "Here you see the map of the people you accompany as leader.") : t("Todavía nadie ha marcado talentos, competencias o conocimientos como organizacionales. Cada persona lo decide en su perfil 360.", "Nobody has marked talents, competencies or knowledge as organisational yet. Each person decides that in their 360 profile.")} <Link href="/equipo/perfil">{t("Mi perfil 360", "My 360 profile")}</Link></div> : (
        <>
          <section className="card" id="concentracion"><b>{t("CONOCIMIENTO QUE DEPENDE DE UNA SOLA PERSONA", "KNOWLEDGE THAT DEPENDS ON ONE PERSON")}</b> · {v.single.length}
            {v.single.length === 0 ? <p className="small"><span className="sig ok">{t("Todo lo registrado lo tienen al menos dos personas", "Everything on record is held by at least two people")}</span></p> : (
              <ul className="plain">{v.single.map((g) => <li key={g.key}><span className="sig attn">{t("una persona", "one person")}</span> <b>{g.label}</b> <span className="src">· {tx(PROFILE_BLOCKS[g.block])}</span> · {g.people[0].name}</li>)}</ul>
            )}
            <p className="src">{t("Si esa persona falta, ese conocimiento falta con ella. Un compromiso de «enseñar a otros» o un respaldo lo resuelven.", "If that person is away, that knowledge is away with them. A “teaching” commitment or a backup resolves it.")} <Link href="/equipo/continuidad">{t("Continuidad", "Continuity")}</Link></p>
          </section>

          {blocks.map((b) => { const rows = v.groups.filter((g) => g.block === b); return (
            <section className="card" key={b} id={`m-${b}`}><b>{tx(PROFILE_BLOCKS[b]).toUpperCase()}</b> · {rows.length} <span className="small muted">{tx(PROFILE_BLOCKS[b].hint)}</span>
              {rows.length === 0 ? <p className="small muted">{t("Nada organizacional registrado.", "Nothing organisational recorded.")}</p> : (
                <div className="tscroll"><table>
                  <thead><tr><th>{t("Qué", "What")}</th><th className="n">{t("Personas", "People")}</th><th>{t("Quiénes", "Who")}</th></tr></thead>
                  <tbody>{rows.map((g) => <tr key={g.key}><td>{g.label}</td><td className="n mono">{g.people.length}</td><td className="small">{g.people.map((p) => p.name).join(", ")}</td></tr>)}</tbody>
                </table></div>
              )}
            </section>
          ); })}
        </>
      )}
      <p className="src">{t("El mapa agrupa lo que cada persona escribió con las mismas palabras; no interpreta ni deduce. No incluye assessments, reflexiones ni nada marcado como privado o compartido solo con el líder. No sirve para decidir qué puede o no puede llegar a hacer alguien.", "The map groups what each person wrote in the same words; it does not interpret or infer. It includes no assessments, reflections or anything marked private or shared only with the leader. It is not a basis for deciding what someone can or cannot come to do.")}</p>
    </div>
  );
}
