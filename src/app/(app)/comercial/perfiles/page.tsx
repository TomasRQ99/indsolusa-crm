import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { profileList } from "@/lib/profiles";
import { ECSA } from "@/lib/profile-rules";

// Comercial · Perfiles (user request 2026-11-12). Every customer has a profile with its diary: what hurts, what they
// struggle with, how each person lives it, the conversations it came from, the follow-up and the material we keep.
// This page is the way in: the customers, with the latest pain on record and the next follow-up.

type SP = { u?: string; q?: string; err?: string };

export default async function ProfilesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const [people, mine] = await Promise.all([
    manage ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.account.count({ where: { internal: false, ownerId: user.id } }),
  ]);
  const u = sp.u === "all" || sp.u === "mine" ? sp.u : sp.u && people.some((p) => p.id === sp.u) ? sp.u : mine > 0 ? "mine" : "all";
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const rows = await profileList(u === "all" ? null : u === "mine" ? user.id : u, q);
  const started = rows.filter((r) => r.entries > 0);
  const late = rows.filter((r) => r.next?.late);
  // Follow-ups that are late first, then the profiles with a diary (latest first), then the ones still empty.
  const sorted = [...rows].sort((a, b) => Number(!!b.next?.late) - Number(!!a.next?.late) || Number(b.entries > 0) - Number(a.entries > 0) || +(b.lastOn ?? 0) - +(a.lastOn ?? 0) || a.name.localeCompare(b.name));

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Perfiles", "Profiles")}</h1>
          <p>{t("El diario de cada cliente: qué le duele, con qué lucha y cómo lo vive cada persona. Lo escribimos después de cada conversación para llegar a la siguiente sabiendo dónde quedamos.", "Each customer's diary: what hurts, what they struggle with and how each person lives it. We write it after every conversation, to arrive at the next one knowing where we left off.")}</p>
        </div>
      </div>
      {sp.err === "cliente" && <div className="note risk">{t("Ese cliente no existe.", "That customer doesn't exist.")}</div>}

      <form method="get" className="goal-pick pf-filter">
        <label>{t("Ver", "View")}
          <select name="u" defaultValue={u}>
            <option value="mine">{t("Mis clientes", "My customers")}</option>
            <option value="all">{t("Toda la empresa", "Whole company")}</option>
            {people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>{t("Buscar", "Search")}<input name="q" defaultValue={q} maxLength={80} placeholder={t("Nombre del cliente", "Customer name")} /></label>
        <button type="submit" className="secondary">{t("Ver", "View")}</button>
      </form>

      {rows.length === 0 ? (
        <section className="card"><p className="small muted">{q ? t(`Ningún cliente coincide con «${q}».`, `No customer matches “${q}”.`) : u === "mine" ? t("No tienes clientes a tu nombre. Cambia a «Toda la empresa».", "You have no customers under your name. Switch to “Whole company”.") : t("Aún no hay clientes.", "There are no customers yet.")}</p></section>
      ) : (
        <>
          <p className="cl-sum">
            <b>{started.length}</b> {t(`de ${rows.length} clientes ya tienen diario.`, `of ${rows.length} customers already have a diary.`)}
            {late.length > 0 && <> <span className="attn-t">{late.length === 1 ? t("Hay 1 seguimiento con la fecha pasada.", "1 follow-up is past its date.") : t(`Hay ${late.length} seguimientos con la fecha pasada.`, `${late.length} follow-ups are past their date.`)}</span></>}
          </p>
          <ul className="pf-list">
            {sorted.map((r) => (
              <li key={r.id}>
                <Link href={`/comercial/perfiles/${r.id}`} className="pf-card" data-state={r.next?.late ? "late" : r.entries > 0 ? "on" : "empty"}>
                  <span className="pf-chead">
                    <b>{r.name}</b>
                    {r.ecsa && <span className="sig info">{t(ECSA[r.ecsa].es, ECSA[r.ecsa].en)}</span>}
                  </span>
                  <span className="src">{r.industry ?? t("Sin industria", "No industry")}{u !== "mine" ? ` · ${r.owner}` : ""} · {r.people === 1 ? t("1 persona", "1 person") : t(`${r.people} personas`, `${r.people} people`)}</span>
                  {r.entries === 0 ? (
                    <span className="pf-empty">{t("Sin diario todavía. Empieza con la última conversación.", "No diary yet. Start with the last conversation.")}</span>
                  ) : (
                    <>
                      <span className="pf-pain">{r.pain ? <><span className="k">{t("Dolor", "Pain")}</span> {r.pain.length > 170 ? `${r.pain.slice(0, 170)}…` : r.pain}</> : <span className="muted">{t("Aún no sabemos qué le duele.", "We don't know yet what hurts.")}</span>}</span>
                      <span className="src">{r.entries === 1 ? t("1 entrada", "1 entry") : t(`${r.entries} entradas`, `${r.entries} entries`)} · {t("última", "latest")}: {i.date(r.lastOn)}</span>
                    </>
                  )}
                  {r.next && <span className={`pf-next${r.next.late ? " late" : ""}`}>→ {r.next.what}{r.next.on ? ` · ${i.date(r.next.on)}` : ""}{r.next.late ? ` · ${t("fecha pasada", "past its date")}` : ""}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
