import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canEdit, canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { dayInput } from "@/lib/domain";
import { isVideo } from "@/lib/contact-line-rules";
import { customerProfile } from "@/lib/profiles";
import { ASPECTS, DIARY_FIELDS, DIARY_ISSUE_TEXT, ECSA, ITEM_KINDS, MAX_PROFILE_FILES, READING_ISSUE_TEXT, canSeeReadings, type DiaryIssue } from "@/lib/profile-rules";
import { DiaryForm, ProfileItemAdd } from "@/components/ProfileForms";
import { addDiaryEntry, addReading, removeDiaryEntry, removeProfileItem, retireReading } from "../actions";

// Comercial · Perfiles · one customer. Top: what the diary says today (pain, struggle, next follow-up). Then the
// diary, the people (how each one lives their work) and the material (documents, products, brands).
// Everything is written by people and signed; SOLU only brings what it already has (conversations, people, brands).

type SP = { ok?: string; err?: string; nuevo?: string };

export default async function ProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { id } = await params;
  const sp = await searchParams;
  const seeReadings = canSeeReadings(user);
  const p = await customerProfile(id, seeReadings);
  if (!p) notFound();
  const { a, entries } = p;
  const manage = canManageAll(user);
  const ownsCustomer = canEdit(user, a.ownerId);

  const lastPain = entries.find((e) => e.pain) ?? null;
  const lastStruggle = entries.find((e) => e.struggle) ?? null;
  const lastEcsa = entries.find((e) => e.ecsa)?.ecsa ?? null;
  const openPlans = entries.filter((e) => e.taskId && p.taskOf.get(e.taskId)?.status === "OPEN").sort((x, y) => +(x.followUpOn ?? 0) - +(y.followUpOn ?? 0));
  const nextPlan = openPlans[0] ?? null;
  const planLate = !!nextPlan?.followUpOn && nextPlan.followUpOn < p.today;

  const meetingKind = (m: { type: string; outcome: string | null }) => isVideo(m.outcome) ? t("Videollamada", "Video call") : m.type === "CALL" ? t("Llamada", "Call") : t("Visita o reunión", "Visit or meeting");
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const person = (c: { firstName: string; lastName: string } | null | undefined) => (c ? `${c.firstName} ${c.lastName}`.trim() : "");

  const okMsg: Record<string, string> = {
    entrada: t("Guardado en el diario.", "Saved to the diary."),
    "entrada-plan": t("Guardado en el diario. El seguimiento quedó como pendiente tuyo con su fecha.", "Saved to the diary. The follow-up is now one of your to-dos, with its date."),
    quitada: t("Entrada quitada del diario. La conversación y el pendiente siguen donde estaban.", "Entry removed from the diary. The conversation and the to-do stay where they were."),
    lectura: t("Anotado. Quien hable con esta persona la próxima vez lo tendrá presente.", "Noted. Whoever speaks with this person next will have it in mind."),
    retirada: t("Marcado como ya no vigente. Queda en el historial.", "Marked as no longer current. It stays in the history."),
    material: t("Quitado del perfil.", "Removed from the profile."),
  };
  const issueText = Object.fromEntries(Object.entries({ ...DIARY_ISSUE_TEXT, ...READING_ISSUE_TEXT }).map(([k, v]) => [k.toLowerCase(), t(v.es, v.en)])) as Record<Lowercase<DiaryIssue>, string>;
  const errMsg: Record<string, string> = {
    ...issueText,
    permiso: t("Eso lo puede quitar quien lo escribió, el responsable del cliente o la dirección.", "That can be removed by whoever wrote it, the customer's owner or management."),
    lectura: t("Elige qué aspecto es y escríbelo.", "Choose which aspect it is and write it."),
    evidencia: t("Falta cómo lo sabemos: qué dijo o hizo la persona. Así nadie tiene que suponer.", "How we know is missing: what the person said or did. That way nobody has to guess."),
    "lectura-permiso": t("La lectura de cada persona la lleva el equipo comercial.", "The reading of each person is kept by the commercial team."),
  };

  return (
    <div className="pf">
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/deals">{t("Comercial", "Commercial")}</Link> · <Link href="/comercial/perfiles">{t("Perfiles", "Profiles")}</Link></div>
          <h1>{a.name}</h1>
          <p className="small">
            {a.industry ?? t("Sin industria", "No industry")} · {t("Responsable", "Owner")}: {a.owner.name}
            {lastEcsa && <> · <span className="sig info">{t(ECSA[lastEcsa].es, ECSA[lastEcsa].en)}</span></>}
          </p>
          <p className="small"><Link href={`/accounts/${a.id}`}>{t("Ficha del cliente", "Customer page")}</Link> · <Link href={`/mercado/empresas/${a.id}`}>{t("Cómo funciona esta empresa", "How this company works")}</Link> · <Link href={`/visitas?cliente=${a.id}#proximas`}>{t("Planear una visita", "Plan a visit")}</Link></p>
        </div>
        <span className="grow" />
        <Link href={`/comercial/perfiles/${a.id}?nuevo=1#diario`} className="btn">{t("Escribir en el diario", "Write in the diary")}</Link>
      </div>
      {sp.ok && okMsg[sp.ok] && <div className="note okn">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note attn">{errMsg[sp.err]}</div>}

      {/* What the diary says today: read in five seconds before picking up the phone. */}
      <section className="pf-now" aria-label={t("Lo esencial", "The essentials")}>
        <div className="card" data-zone="risk">
          <b>{t("QUÉ LE DUELE", "WHAT HURTS")}</b>
          {lastPain ? <><p className="pf-quote">{lastPain.pain}</p><span className="src">{i.date(lastPain.happenedOn)}{lastPain.contact ? ` · ${person(lastPain.contact)}` : ""} · {t("lo anotó", "noted by")} {lastPain.authorName}</span></> : <p className="small muted">{t("Aún no lo sabemos. Es la primera pregunta de la próxima conversación.", "We don't know yet. It is the first question of the next conversation.")}</p>}
        </div>
        <div className="card" data-zone="act">
          <b>{t("CON QUÉ LUCHA", "WHAT THEY STRUGGLE WITH")}</b>
          {lastStruggle ? <><p className="pf-quote">{lastStruggle.struggle}</p><span className="src">{i.date(lastStruggle.happenedOn)}{lastStruggle.contact ? ` · ${person(lastStruggle.contact)}` : ""}</span></> : <p className="small muted">{t("Sin anotar: qué ha intentado y qué se lo impide.", "Not noted: what they tried and what is in the way.")}</p>}
        </div>
        <div className="card" data-zone={nextPlan ? (planLate ? "act" : "flow") : "plan"}>
          <b>{t("PRÓXIMO SEGUIMIENTO", "NEXT FOLLOW-UP")}</b>
          {nextPlan ? (
            <>
              <p className="pf-quote">{nextPlan.followUp}</p>
              <span className={`src${planLate ? " warn-text" : ""}`}>{i.date(nextPlan.followUpOn)}{planLate ? ` · ${t("la fecha ya pasó: hoy es buen día para hacerlo", "the date has passed: today is a good day to do it")}` : ""} · {nextPlan.authorName}{openPlans.length > 1 ? ` · ${t(`y ${openPlans.length - 1} más`, `and ${openPlans.length - 1} more`)}` : ""}</span>
            </>
          ) : <p className="small muted">{entries.length ? t("No hay un seguimiento planeado. Conviene dejar uno con fecha al escribir la próxima entrada.", "No follow-up is planned. It helps to leave one with a date when writing the next entry.") : t("Aparecerá aquí cuando escribas la primera entrada con su plan.", "It will show here once you write the first entry with its plan.")}</p>}
        </div>
      </section>

      <section className="pf-sec" id="diario">
        <h2>{t("Diario", "Diary")}{entries.length > 0 && <span className="pf-n">{entries.length}</span>}</h2>
        <details className="card pf-new" open={entries.length === 0 || sp.nuevo === "1" || !!(sp.err && sp.err in issueText)}>
          <summary><b>{t("Nueva entrada", "New entry")}</b> <span className="src">{t("Después de una llamada, una videollamada o una visita", "After a call, a video call or a visit")}</span></summary>
          <DiaryForm es={i.es} action={addDiaryEntry.bind(null, a.id)} todayInput={dayInput(p.today)}
            contacts={a.contacts.map((c) => ({ id: c.id, label: `${person(c)}${c.title ? ` · ${c.title}` : ""}` }))}
            meetings={p.meetings.map((m) => ({ id: m.id, used: p.usedMeetings.has(m.id), label: `${i.date(m.occurredAt)} · ${meetingKind(m)} · ${short(m.subject, 60)}${m.contact ? ` · ${person(m.contact)}` : ""}` }))} />
        </details>

        {entries.length === 0 ? <p className="small muted">{t("El diario está vacío. La primera entrada puede salir de la última conversación que tuviste con ellos.", "The diary is empty. The first entry can come from the last conversation you had with them.")}</p> : (
          <ol className="pf-diary">
            {entries.map((e) => {
              const m = e.activityId ? p.meetingOfEntry.get(e.activityId) : null;
              const task = e.taskId ? p.taskOf.get(e.taskId) : null;
              const late = task?.status === "OPEN" && !!e.followUpOn && e.followUpOn < p.today;
              return (
                <li key={e.id} className="pf-entry" id={`e-${e.id}`}>
                  <header>
                    <b>{i.date(e.happenedOn)}</b>
                    <span className="sig wait">{m ? meetingKind(m) : e.activityId ? t("Conversación", "Conversation") : t("Nota", "Note")}</span>
                    {e.ecsa && ECSA[e.ecsa] && <span className="sig info">{t(ECSA[e.ecsa].es, ECSA[e.ecsa].en)}</span>}
                    {e.contact && <span className="small">{t("con", "with")} <a href={`#p-${e.contact.id}`}>{person(e.contact)}</a></span>}
                    <span className="grow" />
                    <span className="src">{e.authorName}</span>
                  </header>
                  <dl className="pf-dl">
                    {DIARY_FIELDS.filter((f) => e[f.key]).map((f) => (
                      <div key={f.key} data-k={f.key}><dt>{t(f.label.es, f.label.en)}</dt><dd>{e[f.key]}</dd></div>
                    ))}
                  </dl>
                  {e.followUp && (
                    <p className={`pf-next${late ? " late" : ""}`}>→ {e.followUp} · {i.date(e.followUpOn)}
                      {task ? (task.status === "DONE" ? <span className="sig ok">{t("hecho", "done")}</span> : <> <span className={`sig ${late ? "attn" : "wait"}`}>{late ? t("fecha pasada", "past its date") : t("pendiente", "to do")}</span> <Link className="small" href="/tasks">{t("Ver en Pendientes", "See in To-dos")}</Link></>) : <span className="src"> · {t("el pendiente ya no existe", "the to-do no longer exists")}</span>}
                    </p>
                  )}
                  {(e.authorId === user.id || manage) && (
                    <form action={removeDiaryEntry.bind(null, e.id)}><button type="submit" className="linkish" data-confirm={t("¿Quitar esta entrada del diario? La conversación y el pendiente no se borran.", "Remove this entry from the diary? The conversation and the to-do are not deleted.")}>{t("Quitar entrada", "Remove entry")}</button></form>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section className="pf-sec" id="personas">
        <h2>{t("Personas", "People")}{a.contacts.length > 0 && <span className="pf-n">{a.contacts.length}</span>}</h2>
        <p className="small muted pf-lead">{seeReadings
          ? t("Cómo vive su trabajo cada persona: qué la mueve, qué le preocupa, cómo decide. Siempre con lo que dijo o hizo, para servirle mejor y nunca para presionarla. Escribe solo lo que estarías tranquilo de que la persona leyera.", "How each person lives their work: what moves them, what worries them, how they decide. Always with what they said or did, to serve them better and never to pressure them. Write only what you would be comfortable with the person reading.")
          : t("La lectura de cada persona la lleva el equipo comercial. Aquí ves quiénes son y cómo contactarlos.", "The reading of each person is kept by the commercial team. Here you see who they are and how to reach them.")}</p>
        {a.contacts.length === 0 ? <p className="small muted">{t("Este cliente no tiene personas registradas.", "This customer has no people on record.")} <Link href="/contacts">{t("Agregar un contacto", "Add a contact")}</Link></p> : (
          <div className="pf-people">
            {a.contacts.map((c) => {
              const mine = p.readings.filter((r) => r.contactId === c.id);
              const current = mine.filter((r) => !r.supersededAt);
              const old = mine.filter((r) => r.supersededAt);
              return (
                <article key={c.id} className="card" id={`p-${c.id}`}>
                  <b>{person(c)}</b>
                  <span className="src block">{c.title ?? t("Cargo no registrado", "No job title on file")}{c.phone && <> · <a href={`tel:${c.phone}`}>{c.phone}</a></>}{c.email && <> · <a href={`mailto:${c.email}`}>{c.email}</a></>} · <Link href={`/mercado/personas/${c.id}`}>{t("Relación y compromisos", "Relationship and commitments")}</Link></span>
                  {seeReadings && (
                    <>
                      {current.length === 0 ? <p className="small muted">{t("Aún no hemos anotado cómo vive su trabajo.", "We haven't noted yet how they live their work.")}</p> : (
                        <ul className="mk-ul">
                          {Object.keys(ASPECTS).flatMap((k) => current.filter((r) => r.aspect === k)).map((r) => (
                            <li key={r.id} className="small">
                              <span className="pf-aspect">{t(ASPECTS[r.aspect].es, ASPECTS[r.aspect].en)}</span> {r.statement}
                              <span className="src block">{t("Cómo lo sabemos", "How we know")}: {r.evidence} · {r.authorName} · {i.date(r.observedOn)}</span>
                              <form action={retireReading.bind(null, r.id)}><button type="submit" className="linkish">{t("Ya no es así", "No longer true")}</button></form>
                            </li>
                          ))}
                        </ul>
                      )}
                      <details className="pf-add">
                        <summary className="qa-btn">+ {t("Anotar algo de esta persona", "Note something about this person")}</summary>
                        <form action={addReading.bind(null, c.id)} className="qa-form pf-form">
                          <label>{t("Qué aspecto", "Which aspect")}<select name="aspect" defaultValue="MOVES">{Object.entries(ASPECTS).map(([k, v]) => <option key={k} value={k}>{t(v.es, v.en)}</option>)}</select></label>
                          <label>{t("Qué observaste", "What you observed")}<textarea name="statement" rows={2} maxLength={500} required placeholder={t(ASPECTS.MOVES.ph.es, ASPECTS.MOVES.ph.en)} /></label>
                          <label>{t("Cómo lo sabemos: qué dijo o hizo", "How we know: what they said or did")}<input name="evidence" maxLength={500} required placeholder={t("Ej.: Lo dijo en la visita del 3 de noviembre", "E.g.: Said it during the Nov 3 visit")} /></label>
                          <div><button type="submit">{t("Guardar", "Save")}</button></div>
                        </form>
                      </details>
                      {old.length > 0 && (
                        <details><summary className="small">{t(`Ya no vigente (${old.length})`, `No longer current (${old.length})`)}</summary>
                          <ul className="mk-ul">{old.map((r) => <li key={r.id} className="small muted">{t(ASPECTS[r.aspect]?.es ?? r.aspect, ASPECTS[r.aspect]?.en ?? r.aspect)}: {r.statement}<span className="src block">{r.authorName} · {i.date(r.observedOn)}</span></li>)}</ul>
                        </details>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="pf-sec" id="material">
        <h2>{t("Documentos, productos y marcas", "Documents, products and brands")}</h2>
        <p className="small muted pf-lead">{t(`Lo que conviene tener a la mano de este cliente. Las fotos se reducen solas antes de subir. Archivos: ${p.files} de ${MAX_PROFILE_FILES}.`, `What is worth having at hand for this customer. Photos are shrunk automatically before uploading. Files: ${p.files} of ${MAX_PROFILE_FILES}.`)}</p>
        <div className="pf-mat">
          {(Object.keys(ITEM_KINDS) as (keyof typeof ITEM_KINDS)[]).map((kind) => {
            const list = p.items.filter((x) => x.kind === kind);
            const k = ITEM_KINDS[kind];
            return (
              <div key={kind} className="card" data-kind={kind}>
                <b>{t(k.es, k.en)}{list.length > 0 && <span className="pf-n">{list.length}</span>}</b>
                {kind === "BRAND_USED" && p.knownBrands.length > 0 && <p className="src">{t("SOLU ya conoce, por los equipos registrados en Mercado", "SOLU already knows, from the equipment recorded in Market")}: {p.knownBrands.join(" · ")}</p>}
                {list.length === 0 ? <p className="small muted">{kind === "DOCUMENT" ? t("Planos, fichas, listados o lo que nos hayan entregado.", "Drawings, datasheets, lists or whatever they handed us.") : kind === "PRODUCT_NEED" ? t("Fotos o enlaces de lo que podrían necesitar.", "Photos or links of what they could need.") : t("Las marcas que tienen instaladas o que prefieren.", "The brands they have installed or prefer.")}</p> : (
                  <ul className="pf-items">
                    {list.map((x) => {
                      const img = !!x.mime && x.mime.startsWith("image/");
                      return (
                        <li key={x.id}>
                          {x.size > 0 && <a className="pf-thumb" href={`/comercial/perfiles/archivo/${x.id}`} target="_blank" rel="noreferrer">{img ? <img src={`/comercial/perfiles/archivo/${x.id}`} alt={x.title} loading="lazy" /> : <span>PDF</span>}</a>}
                          <div>
                            <b>{x.title}</b>
                            {x.note && <span className="small block">{x.note}</span>}
                            {x.url && <a className="small block pf-url" href={x.url} target="_blank" rel="noreferrer noopener">{t("Abrir enlace", "Open link")} ↗ <span className="muted">{hostOf(x.url)}</span></a>}
                            <span className="src block">{x.uploadedByName} · {i.date(x.createdAt)}{x.size > 0 ? ` · ${Math.max(1, Math.round(x.size / 1024))} KB` : ""}</span>
                            {(x.uploadedByName === user.name || ownsCustomer) && <form action={removeProfileItem.bind(null, x.id)}><button type="submit" className="linkish" data-confirm={t(`¿Quitar «${x.title}» del perfil?`, `Remove “${x.title}” from the profile?`)}>{t("Quitar", "Remove")}</button></form>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <ProfileItemAdd es={i.es} accountId={a.id} kind={kind} room={MAX_PROFILE_FILES - p.files} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
