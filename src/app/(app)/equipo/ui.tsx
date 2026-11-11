import Link from "next/link";
import type { I18n } from "@/lib/i18n";
import { PRIVACY } from "@/lib/team-rules";

// Módulo 16 · pieces shared by the Equipo screens.

type Txt = { es: string; en: string };

export function Notes({ sp, ok, err }: { sp: { ok?: string; err?: string }; ok: Record<string, string>; err: Record<string, string> }) {
  return (
    <>
      {sp.ok && ok[sp.ok] && <div className="note okn" role="status">{ok[sp.ok]}</div>}
      {sp.err && err[sp.err] && <div className="note risk" role="alert">{err[sp.err]}</div>}
    </>
  );
}

/** A list of the agreement, or a plain "not defined yet" when the role profile does not say it. */
export function Lines({ items, i }: { items: string[]; i: I18n }) {
  return items.length ? <ul className="plain">{items.map((x, k) => <li key={k}>{x}</li>)}</ul> : <p className="small muted">{i.t("Aún sin definir en el acuerdo de rol.", "Not yet defined in the role agreement.")}</p>;
}

export function PrivacyTag({ value, i }: { value: string; i: I18n }) {
  const p = PRIVACY[value];
  return <span className={`sig ${value === "PRIVATE" ? "wait" : value === "ORG" ? "info" : "dash"}`} title={p ? i.t(`Lo ve: ${p.who.es}`, `Seen by: ${p.who.en}`) : ""}>{p ? i.t(p.es, p.en) : value}</span>;
}
export function PrivacySelect({ i, value, levels = ["PRIVATE", "SHARED", "ORG"], name = "privacy" }: { i: I18n; value: string; levels?: string[]; name?: string }) {
  return (
    <select name={name} defaultValue={levels.includes(value) ? value : levels[0]} aria-label={i.t("Quién lo ve", "Who sees it")}>
      {levels.map((k) => <option key={k} value={k}>{i.t(`${PRIVACY[k].es}: ${PRIVACY[k].who.es}`, `${PRIVACY[k].en}: ${PRIVACY[k].who.en}`)}</option>)}
    </select>
  );
}

/** Lets a leader, a mentor or Gerencia open the same screen for a person they accompany. Not shown to someone who only sees themselves. */
export function PersonSwitch({ people, current, me, path, i }: { people: { id: string; name: string }[]; current: string; me: string; path: string; i: I18n }) {
  if (people.length <= 1) return null;
  return (
    <form method="get" action={path} className="eq-pick">
      <label>{i.t("Persona", "Person")}<select name="p" defaultValue={current}>{people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? i.t(`${p.name} (yo)`, `${p.name} (me)`) : p.name}</option>)}</select></label>
      <button type="submit" className="secondary sm">{i.t("Ver", "View")}</button>
    </form>
  );
}

export function NoAccess({ i, back }: { i: I18n; back: string }) {
  return <div className="note risk">{i.t("Esta parte de una persona la ven ella misma, quien la acompaña (su líder o su mentor) y, en lo organizacional, Gerencia.", "This part of a person is seen by the person, by whoever accompanies them (leader or mentor) and, for what is organisational, by Management.")} <Link href={back}>{i.t("Volver", "Back")}</Link></div>;
}

export const tOf = (i: I18n) => (x: Txt) => i.t(x.es, x.en);
/** Query string that keeps the person being viewed. */
export const qp = (personId: string, me: string) => (personId === me ? "" : `?p=${personId}`);
