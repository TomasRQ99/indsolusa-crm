import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { db } from "@/lib/db";
import { dayInput } from "@/lib/domain";
import { VALUE_KINDS } from "@/lib/goal-rules";
import { contactLine, contactLineCompany, getContactLinePolicy, type LineRow } from "@/lib/contact-line";
import { CHANNEL_LABEL, ago, span } from "@/lib/contact-line-rules";
import { ContactRegister } from "@/components/ContactRegister";
import { registerContact, saveContactLinePolicy } from "./actions";

// Comercial · Línea de comunicaciones (user request 2026-11-12). Every customer company placed by the last time we
// were in contact. A band opens a slide with its companies; choosing one lets the person register a call, an email
// or a note, or go to Visitas to plan a visit. Cut points are a versioned policy that management can change.

type SP = { u?: string; rango?: string; cliente?: string; a?: string; ok?: string; err?: string; hecho?: string };

export default async function ContactLinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const manage = canManageAll(user);
  const [pol, people, mine] = await Promise.all([
    getContactLinePolicy(),
    manage ? db.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.account.count({ where: { internal: false, ownerId: user.id } }),
  ]);
  // Whose companies: mine by default (the whole company when I own none); management can also look at one person.
  const u = sp.u === "all" || sp.u === "mine" ? sp.u : sp.u && people.some((p) => p.id === sp.u) ? sp.u : mine > 0 ? "mine" : "all";
  const scope = u === "all" ? null : u === "mine" ? user.id : u;
  const cuts = pol.value.cutsMonths;
  const line = await contactLine(scope, cuts);
  const showOwner = u !== "mine";
  const total = line.rows.length;
  const waiting = line.rows.filter((r) => r.band > 0).length;

  const open = sp.rango != null && /^\d{1,2}$/.test(sp.rango) ? line.bands.find((b) => b.index === Number(sp.rango)) ?? null : null;
  const company = open && sp.cliente ? await contactLineCompany(sp.cliente) : null;
  const companyRow = company ? line.rows.find((r) => r.id === company.id) ?? null : null;
  const done = sp.hecho ? await db.account.findFirst({ where: { id: sp.hecho, internal: false }, select: { name: true } }) : null;

  const href = (o: { rango?: number | null; cliente?: string | null }) => {
    const p = new URLSearchParams({ u });
    if (o.rango != null) p.set("rango", String(o.rango));
    if (o.cliente) p.set("cliente", o.cliente);
    return `/comercial/comunicaciones?${p}`;
  };
  const lastLine = (r: LineRow) => r.last
    ? `${t("Último contacto", "Last contact")}: ${i.date(r.last)} · ${t(ago(r.last, line.today).es, ago(r.last, line.today).en)}${r.channel ? ` · ${t(CHANNEL_LABEL[r.channel].es, CHANNEL_LABEL[r.channel].en)}` : ""}`
    : t("Sin contacto registrado", "No contact on record");
  const okMsg: Record<string, string> = {
    llamada: t(`Llamada registrada${done ? ` con ${done.name}` : ""}. La empresa pasó a «Al día».`, `Call saved${done ? ` with ${done.name}` : ""}. The company moved to “Up to date”.`),
    correo: t(`Correo registrado${done ? ` con ${done.name}` : ""}. La empresa pasó a «Al día».`, `Email saved${done ? ` with ${done.name}` : ""}. The company moved to “Up to date”.`),
    nota: t("Nota guardada en la historia de la empresa.", "Note saved in the company's history."),
    rangos: t("Rangos guardados como nueva versión.", "Ranges saved as a new version."), igual: t("Sin cambios.", "No changes."),
  };
  const errMsg: Record<string, string> = {
    cliente: t("Esa empresa no existe.", "That company doesn't exist."),
    texto: t("Escribe en una línea qué pasó.", "Write in one line what happened."),
    fecha: t("La fecha no puede ser futura.", "The date can't be in the future."),
    permiso: t("Solo la dirección cambia los rangos.", "Only management changes the ranges."),
    rangos: t("Escribe entre 2 y 6 cortes en meses, de menor a mayor. Ejemplo: 1, 3, 6, 12.", "Write 2 to 6 cuts in months, smallest first. Example: 1, 3, 6, 12."),
  };
  const kinds = Object.entries(VALUE_KINDS).map(([key, v]) => ({ key, label: t(v.es, v.en) }));
  const typeLabel: Record<string, string> = { CALL: t("Llamada", "Call"), MEETING: t("Visita o reunión", "Visit or meeting"), EMAIL: t("Correo", "Email"), NOTE: t("Nota", "Note") };
  const initial = sp.a === "llamada" ? "CALL" : sp.a === "correo" ? "EMAIL" : sp.a === "nota" ? "NOTE" : null;
  const inSlide = !!open;

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link></div>
          <h1>{t("Línea de comunicaciones", "Communication line")}</h1>
          <p>{t("Cada empresa según la última vez que hablamos. Entre más a la derecha, más tiempo lleva sin saber de nosotros. Abre un rango para ver sus empresas y registrar el contacto.", "Every company by the last time we spoke. The further right, the longer it has gone without hearing from us. Open a range to see its companies and register the contact.")}</p>
        </div>
      </div>
      {!inSlide && sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {!inSlide && sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

      <form method="get" className="goal-pick" style={{ marginBottom: 12 }}>
        <label>{t("Ver", "View")}
          <select name="u" defaultValue={u}>
            <option value="mine">{t("Mis clientes", "My customers")}</option>
            <option value="all">{t("Toda la empresa", "Whole company")}</option>
            {people.filter((p) => p.id !== user.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="submit" className="secondary">{t("Ver", "View")}</button>
      </form>

      {total === 0 ? (
        <section className="card"><p className="small muted">{u === "mine" ? t("No tienes clientes a tu nombre. Cambia a «Toda la empresa».", "You have no customers under your name. Switch to “Whole company”.") : t("Aún no hay clientes.", "There are no customers yet.")}</p></section>
      ) : (
        <>
          <p className="cl-sum">
            {waiting === 0
              ? t(`Las ${total} empresas están al día: hablamos con todas hace menos de ${span(cuts[0]).es}.`, `All ${total} companies are up to date: we spoke with each less than ${span(cuts[0]).en} ago.`)
              : <><b>{waiting}</b>{" "}{t(`de ${total} empresas llevan más de ${span(cuts[0]).es} sin contacto.`, `of ${total} companies have gone more than ${span(cuts[0]).en} without contact.`)}</>}
          </p>
          <ol className="cl-line" aria-label={t("Rangos de tiempo desde el último contacto", "Time ranges since the last contact")}>
            {line.bands.map((b) => (
              <li key={b.index} className="cl-band" data-tone={b.tone}>
                <span className="cl-dot" aria-hidden="true" />
                <b className="cl-title">{t(b.title.es, b.title.en)}</b>
                <span className="cl-count">{b.rows.length}</span>
                <span className="src block">{t(b.sub.es, b.sub.en)}</span>
                {b.rows.length > 0 && (
                  <>
                    <ul className="cl-names">
                      {b.rows.slice(0, 4).map((r) => <li key={r.id}><Link href={href({ rango: b.index, cliente: r.id })} scroll={false}>{r.name}</Link></li>)}
                    </ul>
                    <Link className="qa-btn cl-open" href={href({ rango: b.index })} scroll={false}>{b.rows.length === 1 ? t("Ver la empresa", "See the company") : t(`Ver las ${b.rows.length} empresas`, `See all ${b.rows.length} companies`)}</Link>
                  </>
                )}
              </li>
            ))}
          </ol>
          <p className="src">{t("Cuenta como contacto una llamada, una visita o reunión, un correo o una conversación de WhatsApp registrados en SOLU. Una nota no cuenta.", "A call, a visit or meeting, an email or a WhatsApp conversation recorded in SOLU counts as a contact. A note doesn't.")}</p>
        </>
      )}

      <section className="card" id="rangos">
        <b>{t("Rangos de tiempo", "Time ranges")}{pol.version > 0 ? ` · v${pol.version}` : ""}</b>
        {manage ? (
          <form action={saveContactLinePolicy} className="qa-form" style={{ maxWidth: 520 }}>
            <label>{t("Cortes en meses, de menor a mayor (12 = 1 año)", "Cuts in months, smallest first (12 = 1 year)")}<input name="cuts" defaultValue={cuts.join(", ")} required maxLength={40} inputMode="numeric" /></label>
            <span className="src">{t("Ejemplo: «1, 3, 6, 12» separa las empresas en 1 mes, 3 meses, 6 meses y 1 año. Puedes usar entre 2 y 6 cortes. El cambio aplica para todos.", "Example: “1, 3, 6, 12” separates companies at 1 month, 3 months, 6 months and 1 year. You can use 2 to 6 cuts. The change applies to everyone.")}</span>
            <button type="submit">{t("Guardar rangos", "Save ranges")}</button>
            {pol.by && <span className="src">{t("Último cambio", "Last change")}: {pol.by} · {i.date(pol.at)}</span>}
          </form>
        ) : <p className="small">{t(`Los cortes son: ${cuts.map((c) => span(c).es).join(", ")}. Los cambia la dirección.`, `The cuts are: ${cuts.map((c) => span(c).en).join(", ")}. Management changes them.`)}</p>}
      </section>

      {open && (
        <>
          <Link className="cl-veil" href={href({})} scroll={false} aria-label={t("Cerrar", "Close")} />
          <aside className="cl-slide" data-tone={open.tone} role="dialog" aria-label={t(open.title.es, open.title.en)}>
            <header className="cl-shead">
              <div>
                <span className="src">{t("Línea de comunicaciones", "Communication line")}</span>
                <b className="block">{t(open.title.es, open.title.en)} · {open.rows.length}</b>
                <span className="src block">{t(open.sub.es, open.sub.en)}</span>
              </div>
              <Link className="qa-btn" href={href({})} scroll={false}>{t("Cerrar", "Close")} ✕</Link>
            </header>
            <div className="cl-sbody">
              {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
              {sp.err && errMsg[sp.err] && <div className="note risk">{errMsg[sp.err]}</div>}

              {company ? (
                <>
                  <Link className="small" href={href({ rango: open.index })} scroll={false}>← {t("Volver a la lista", "Back to the list")}</Link>
                  <div className="cl-co">
                    <h2>{company.name}</h2>
                    <p className="small">{companyRow ? lastLine(companyRow) : ""}</p>
                    <p className="src">{t("Responsable", "Owner")}: {company.owner.name}{company.phone ? ` · ${t("Tel.", "Phone")} ${company.phone}` : ""} · <Link href={`/accounts/${company.id}`}>{t("Abrir la ficha del cliente", "Open the customer page")}</Link></p>
                  </div>
                  <ContactRegister key={company.id} es={i.es} action={registerContact} accountId={company.id} u={u} rango={String(open.index)} todayInput={dayInput(line.today)} kinds={kinds} initial={initial}
                    contacts={company.contacts.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}${c.title ? ` · ${c.title}` : ""}` }))} />
                  {company.contacts.length > 0 && (
                    <div className="cl-sec">
                      <b>{t("Personas", "People")}</b>
                      <ul className="mk-ul">{company.contacts.slice(0, 6).map((c) => <li key={c.id} className="small">{c.firstName} {c.lastName}{c.title && <span className="muted"> · {c.title}</span>}{c.phone && <> · <a href={`tel:${c.phone}`}>{c.phone}</a></>}{c.email && <> · <a href={`mailto:${c.email}`}>{c.email}</a></>}</li>)}</ul>
                    </div>
                  )}
                  <div className="cl-sec">
                    <b>{t("Lo último registrado", "Latest on record")}</b>
                    {company.activities.length === 0 ? <p className="small muted">{t("Nada todavía.", "Nothing yet.")}</p> : (
                      <ul className="mk-ul">{company.activities.map((a) => (
                        <li key={a.id} className="small"><span className="sig wait">{typeLabel[a.type]}</span> {a.subject}
                          <span className="src block">{i.date(a.occurredAt)} · {a.user.name}{a.contact ? ` · ${t("con", "with")} ${a.contact.firstName} ${a.contact.lastName}` : ""}</span>
                          {a.body && <span className="muted block">{a.body.slice(0, 240)}</span>}
                        </li>
                      ))}</ul>
                    )}
                  </div>
                </>
              ) : open.rows.length === 0 ? <p className="small muted">{t("Ninguna empresa en este rango.", "No company in this range.")}</p> : (
                <>
                  <p className="src">{t("Elige una empresa para registrar una llamada, una visita, un correo o una nota. Primero las que más llevan esperando.", "Choose a company to register a call, a visit, an email or a note. The longest wait comes first.")}</p>
                  <ul className="cl-list">
                    {open.rows.map((r) => (
                      <li key={r.id}>
                        <Link href={href({ rango: open.index, cliente: r.id })} scroll={false}>
                          <b>{r.name}</b>
                          <span className="src block">{lastLine(r)}{showOwner ? ` · ${r.owner}` : ""}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
