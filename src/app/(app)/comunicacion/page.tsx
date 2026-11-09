import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { loadThreads, threadScope } from "@/lib/comm-store";
import { draftReply, missingInfo } from "@/lib/comm";
import { mailConfig } from "@/lib/mail";
import { Popovers } from "@/components/Popovers";
import { applyToJourney, closeThread, decideItem, linkContact, registerMessage, sendReply, syncEmails } from "./actions";
import { reserveTime } from "../mi-dia/actions";

// Communication Intelligence: not an inbox and not surveillance. Three zones:
// relevant threads · the natural conversation · "SOLU understood" (facts vs inferences, confirmed by a person).

const Spark = ({ s = 12 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" /></svg>
);
const strip = (s: string | null | undefined) => (s ?? "").replace(/ \(ejemplo\)$/, "");
const FIELD_ORDER = ["product", "reference", "qty", "result", "date", "urgency", "journey"];

export default async function ComunicacionPage({ searchParams }: { searchParams: Promise<{ t?: string; ok?: string; err?: string; mail?: string; n?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;

  const loadThread = (tid: string) =>
    Promise.all([
      db.commThread.findFirst({
        where: { id: tid, ...threadScope(user) },
        include: {
          account: { select: { id: true, name: true } },
          contact: true,
          deal: { select: { id: true, code: true, title: true } },
          messages: { orderBy: { sentAt: "asc" }, include: { attachments: { select: { id: true, name: true, mime: true } } } },
          items: { include: { decidedBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
        },
      }),
      db.deal.findMany({ where: { account: { threads: { some: { id: tid } } }, stage: { not: "LOST" }, resultAchievedAt: null }, select: { id: true, code: true, title: true }, orderBy: { updatedAt: "desc" } }),
    ]);
  // When the thread is in the URL, it loads in the same parallel batch as the list.
  const [rows, contacts, early] = await Promise.all([
    loadThreads(user),
    db.contact.findMany({
      where: user.role === "ADMIN" || user.role === "MANAGER" ? {} : { account: { ownerId: user.id } },
      select: { id: true, firstName: true, lastName: true, account: { select: { name: true } } },
      orderBy: { firstName: "asc" },
      take: 300,
    }),
    sp.t ? loadThread(sp.t) : Promise.resolve(null),
  ]);
  rows.sort((a, b) => b.rank - a.rank || +b.lastAt - +a.lastAt);
  const needYou = rows.filter((r) => r.needsYou);
  const controlled = rows.filter((r) => !r.needsYou);
  const selectedId = sp.t && rows.some((r) => r.id === sp.t) ? sp.t : needYou[0]?.id ?? rows[0]?.id ?? null;
  const [th, openDeals] = selectedId ? (selectedId === sp.t && early ? early : await loadThread(selectedId)) : [null, []];
  const graph = mailConfig().provider === "graph";

  const fieldLabel: Record<string, string> = {
    product: t("Producto candidato", "Candidate product"),
    reference: t("Referencia", "Reference"),
    qty: t("Cantidad", "Quantity"),
    result: t("Resultado deseado", "Desired result"),
    date: t("Fecha", "Date"),
    urgency: t("Urgencia", "Urgency"),
    journey: "Journey",
  };
  const showValue = (field: string, v: string) => (field === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? i.date(new Date(`${v}T00:00:00Z`)) : v);
  const chan = (c: string) => (c === "WHATSAPP" ? "WhatsApp" : c === "EMAIL" ? t("Correo", "Email") : c === "CALL" ? t("Llamada", "Call") : t("Nota", "Note"));
  const time = (d: Date) => new Intl.DateTimeFormat(i.es ? "es-CO" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bogota" }).format(d);
  const when = (d: Date) => {
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 60) return t(`hace ${Math.max(1, mins)} min`, `${Math.max(1, mins)} min ago`);
    if (mins < 24 * 60) return t(`hoy ${time(d)}`, `today ${time(d)}`);
    return `${i.day(d)} ${time(d)}`;
  };

  const okMsg: Record<string, string> = {
    registrado: t("Mensaje registrado. SOLU lo leyó.", "Message recorded. SOLU read it."),
    confirmed: t("Confirmado.", "Confirmed."),
    corrected: t("Corregido. SOLU usará tu dato.", "Corrected. SOLU will use your value."),
    rejected: t("Descartado.", "Discarded."),
    journey: t("Listo: la necesidad quedó en el Journey con su fuente.", "Done: the need is on the Journey with its source."),
    enviado: t("Respuesta enviada desde el correo de la empresa.", "Reply sent from the company mailbox."),
    incierto: t("Microsoft no confirmó el envío: puede que sí haya salido. Antes de reenviarla, revisa la carpeta Enviados de sales@ en Outlook para no duplicarla.", "Microsoft didn't confirm the send: it may have gone out. Before resending, check sales@'s Sent Items in Outlook so it isn't duplicated."),
    respuesta: t("Respuesta registrada.", "Reply recorded."),
    vinculado: t("Conversación vinculada al contacto.", "Conversation linked to the contact."),
    cerrado: t("Listo. Sale de «Necesita de ti».", "Done. It leaves “Needs you”."),
    reservado: t("Tiempo reservado en tu agenda.", "Time reserved in your agenda."),
    sync: t(`Correos de clientes revisados: ${sp.n ?? 0} nuevo(s).`, `Customer emails checked: ${sp.n ?? 0} new.`),
  };
  const errMsg: Record<string, string> = {
    tipo: t("Solo fotos JPG, PNG, WEBP o GIF.", "Only JPG, PNG, WEBP or GIF photos."),
    grande: t("La foto pesa más de 5 MB.", "The photo is larger than 5 MB."),
    vacio: t("Escribe algo o adjunta una foto.", "Write something or attach a photo."),
    "sin-cliente": t("Primero vincula la conversación a un contacto de un cliente.", "First link the conversation to a customer contact."),
    "sin-correo": t("Este contacto no tiene correo registrado.", "This contact has no email on file."),
    correo: t("No se pudo enviar el correo. Revisa la configuración de correo en Mi perfil.", "The email could not be sent. Check the email settings in My profile."),
  };
  const mailMsg: Record<string, string> = {
    DENIED: t("Microsoft no dio permiso para leer el buzón. Falta el permiso Mail.Read con consentimiento de administrador (ver pasos en el resumen).", "Microsoft did not allow reading the mailbox. The Mail.Read permission with admin consent is missing."),
    NOT_CONFIGURED: t("El correo de la empresa no está conectado por Microsoft Graph.", "The company mailbox is not connected through Microsoft Graph."),
    OTHER: t("No se pudo leer el buzón. Intenta de nuevo en unos minutos.", "Couldn't read the mailbox. Try again in a few minutes."),
  };

  const QA = ({ label, children, wide, right, primary }: { label: React.ReactNode; children: React.ReactNode; wide?: boolean; right?: boolean; primary?: boolean }) => (
    <details className="qa">
      <summary className={primary ? "btn sm" : "qa-btn"}>{label}</summary>
      <div className={`qa-pop${wide ? " wide" : ""}${right ? " right" : ""}`}>{children}</div>
    </details>
  );

  const RegisterForm = ({ threadId }: { threadId?: string }) => (
    <form action={registerMessage} className="qa-form">
      {threadId ? <input type="hidden" name="threadId" value={threadId} /> : (
        <>
          <div className="qa-row">
            <select name="channel" defaultValue="WHATSAPP" aria-label={t("Canal", "Channel")}>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="CALL">{t("Llamada", "Call")}</option>
              <option value="EMAIL">{t("Correo", "Email")}</option>
              <option value="NOTE">{t("Nota", "Note")}</option>
            </select>
            <select name="contactId" defaultValue="" aria-label={t("Contacto", "Contact")} style={{ flex: "1 1 160px" }}>
              <option value="">{t("Contacto…", "Contact…")}</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.account ? ` · ${strip(c.account.name)}` : ""}</option>)}
            </select>
          </div>
          <input name="partyName" placeholder={t("o nombre, si no es contacto todavía", "or name, if not a contact yet")} />
        </>
      )}
      {threadId && (
        <select name="direction" defaultValue="IN" aria-label={t("Quién escribe", "Who writes")}>
          <option value="IN">{t("Mensaje del cliente", "Customer message")}</option>
          <option value="OUT">{t("Lo que yo respondí", "What I replied")}</option>
        </select>
      )}
      <textarea name="body" rows={4} placeholder={t("Pega aquí el mensaje tal cual lo escribió", "Paste the message exactly as written")} />
      <label>{t("Fotos (ej.: placa del equipo)", "Photos (e.g. equipment nameplate)")}<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif" multiple /></label>
      <button type="submit">{t("Guardar y que SOLU lo lea", "Save and let SOLU read it")}</button>
    </form>
  );

  // ---------- SOLU entendió ----------
  const items = th ? [...th.items].sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field)) : [];
  const live = items.filter((x) => x.status !== "REJECTED");
  const facts = live.filter((x) => x.basis === "FACT" || x.status === "CORRECTED");
  const inferences = live.filter((x) => x.basis === "INFERENCE" && x.status !== "CORRECTED");
  const proposed = inferences.filter((x) => x.status === "PROPOSED");
  const missing = missingInfo(live);
  const hasNeed = live.some((x) => x.field === "product");
  // The primary CTA exists only when a human confirmation adds value: there are inferences to confirm
  // and a customer to attach them to, or the need is not on a Journey yet.
  const ctaValue = !!th && !!th.accountId && hasNeed && (proposed.length > 0 || !th.dealId);
  const inferredJourney = live.find((x) => x.field === "journey")?.value ?? "";
  const defaultDeal = th?.dealId ?? openDeals.find((d) => inferredJourney.startsWith(d.code ?? "~"))?.id ?? "new";
  const firstName = th?.contact?.firstName ?? strip(th?.partyName).split(" ")[0] ?? "";
  const draft = th ? draftReply({ firstName, me: user.name.split(" ")[0], items: live }) : "";
  const phone = th?.channel === "WHATSAPP" ? (th.partyAddr ?? th.contact?.phone ?? "").replace(/[^\d]/g, "") : "";

  const ItemRow = ({ x }: { x: (typeof items)[number] }) => {
    const inf = x.basis === "INFERENCE" && x.status !== "CORRECTED";
    return (
      <div className={`ci-item${inf ? " inf" : " fact"}`}>
        <div className="ci-item-h">
          <span className="k">{fieldLabel[x.field] ?? x.field}</span>
          {inf ? <span className="tag inf"><Spark s={10} /> {t("Inferencia", "Inference")}</span> : <span className="tag fact">✓ {x.status === "CORRECTED" ? t("Dato tuyo", "Your data") : t("Hecho", "Fact")}</span>}
        </div>
        <b className="ci-v">{showValue(x.field, x.value)}</b>
        {x.status !== "CORRECTED" && <span className="ci-ev">{x.basis === "FACT" ? `«${x.evidence}»` : x.evidence}</span>}
        {inf && x.reasoning && <span className="ci-why">{x.reasoning}</span>}
        {x.status === "CONFIRMED" && <span className="src">✓ {t("Confirmado por", "Confirmed by")} {x.decidedBy?.name ?? "—"}</span>}
        {x.status === "CORRECTED" && <span className="src">{t("Corregido por", "Corrected by")} {x.decidedBy?.name ?? "—"}</span>}
        {x.status === "PROPOSED" && (
          <div className="ci-act">
            {inf && <form action={decideItem.bind(null, x.id, "CONFIRMED")}><button type="submit" className="qa-btn">✓ {t("Es correcto", "Correct")}</button></form>}
            <QA label={inf ? t("Corregir", "Correct it") : t("Corregir", "Edit")}>
              <form action={decideItem.bind(null, x.id, "CORRECTED")} className="qa-form">
                <label>{fieldLabel[x.field]}<input name="value" type={x.field === "date" ? "date" : "text"} defaultValue={x.field === "reference" && /^Por leer/.test(x.value) ? "" : x.value} required placeholder={x.field === "reference" ? t("Ej.: 6SL3210-1KE21-7UF1 · 7,5 kW", "E.g.: 6SL3210-1KE21-7UF1 · 7.5 kW") : ""} /></label>
                <button type="submit">{t("Guardar", "Save")}</button>
              </form>
            </QA>
            {inf && <form action={decideItem.bind(null, x.id, "REJECTED")}><button type="submit" className="qa-btn" title={t("No aplica", "Doesn't apply")}>{t("Descartar", "Discard")}</button></form>}
          </div>
        )}
      </div>
    );
  };

  const ThreadRow = ({ r }: { r: (typeof rows)[number] }) => (
    <Link href={`/comunicacion?t=${r.id}`} className={`ci-thread${r.id === selectedId ? " on" : ""}`} aria-current={r.id === selectedId ? "true" : undefined}>
      <span className="ci-th-top">
        <b>{strip(r.contact ? `${r.contact.firstName} ${r.contact.lastName}` : r.partyName) || t("Sin nombre", "No name")}</b>
        <span className="ci-when">{when(r.lastAt)}</span>
      </span>
      <span className="ci-th-sub">{[strip(r.account?.name), chan(r.channel)].filter(Boolean).join(" · ")}</span>
      <span className="ci-gist">{r.gist ?? r.subject ?? (r.messages[0]?.attachments.length ? t("Foto", "Photo") : r.messages[0]?.body.slice(0, 70))}</span>
      <span className="ci-tags">
        {r.urgent && <span className="sig risk">{t("Urgente", "Urgent")}</span>}
        {r.proposed > 0 && <span className="sig ai">{t(`${r.proposed} por confirmar`, `${r.proposed} to confirm`)}</span>}
        {r.unanswered && <span className="sig attn">{t("Sin responder", "Unanswered")}</span>}
        {r.deal?.code && <span className="sig wait">{r.deal.code}</span>}
      </span>
    </Link>
  );

  return (
    <div className="ci">
      <Popovers />
      {sp.ok && okMsg[sp.ok] && <div className="note okn" role="status">{okMsg[sp.ok]}</div>}
      {sp.err && errMsg[sp.err] && <div className="note attn" role="status">{errMsg[sp.err]}</div>}
      {sp.mail && mailMsg[sp.mail] && <div className="note attn" role="status">{mailMsg[sp.mail]}</div>}

      <div className="ci-head">
        <div>
          <h1>{t("Comunicación", "Communication")}</h1>
          <p>
            {needYou.length === 0
              ? t("Ninguna conversación necesita de ti ahora.", "No conversation needs you right now.")
              : t(`${needYou.length} ${needYou.length === 1 ? "conversación necesita" : "conversaciones necesitan"} de ti`, `${needYou.length} conversation${needYou.length === 1 ? " needs" : "s need"} you`)}
            {controlled.length > 0 && t(` · ${controlled.length} con control`, ` · ${controlled.length} under control`)}
          </p>
        </div>
        <span className="grow" />
        <QA label={t("+ Registrar mensaje", "+ Record message")} wide right><RegisterForm /></QA>
        {graph && (
          <form action={syncEmails}>
            {selectedId && <input type="hidden" name="t" value={selectedId} />}
            <button type="submit" className="qa-btn">{t("Traer correos de clientes", "Fetch customer emails")}</button>
          </form>
        )}
      </div>

      <div className="ci-grid">
        {/* ---------- 1. Relevant threads ---------- */}
        <nav className="ci-zone ci-threads" aria-label={t("Hilos relevantes", "Relevant threads")}>
          <div className="ci-zh"><b>{t("HILOS RELEVANTES", "RELEVANT THREADS")}</b></div>
          {needYou.length > 0 && <span className="ci-sec">{t("Necesitan de ti", "Need you")}</span>}
          {needYou.map((r) => <ThreadRow key={r.id} r={r} />)}
          {controlled.length > 0 && (
            <details className="ci-more" open={needYou.length === 0 || controlled.some((r) => r.id === selectedId)}>
              <summary>{t(`Con control (${controlled.length})`, `Under control (${controlled.length})`)}</summary>
              {controlled.map((r) => <ThreadRow key={r.id} r={r} />)}
            </details>
          )}
          {rows.length === 0 && <p className="quiet-p">{t("Aún no hay conversaciones. Registra un WhatsApp o trae los correos de clientes.", "No conversations yet. Record a WhatsApp or fetch customer emails.")}</p>}
          <p className="src ci-scope">{t("Solo conversaciones con clientes conocidos de los últimos 45 días. Lo demás sigue en Outlook o en tu teléfono.", "Only conversations with known customers from the last 45 days. Everything else stays in Outlook or on your phone.")}</p>
        </nav>

        {/* ---------- 2. Natural conversation ---------- */}
        <section className="ci-zone ci-conv" aria-label={t("Conversación", "Conversation")}>
          {!th ? <p className="quiet-p">{t("Elige una conversación.", "Pick a conversation.")}</p> : (
            <>
              <div className="ci-conv-h">
                <div>
                  <b>{strip(th.contact ? `${th.contact.firstName} ${th.contact.lastName}` : th.partyName)}</b>
                  <span className="src">{[th.contact?.title, th.account && strip(th.account.name), chan(th.channel), th.partyAddr].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="grow" />
                {th.deal && <Link href={`/deals/${th.deal.id}`} className="qa-btn">{th.deal.code ?? "Journey"} →</Link>}
              </div>
              {th.subject && <p className="ci-subject">{th.subject}</p>}
              <div className="ci-msgs">
                {th.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.direction === "IN" ? "in" : "out"}`}>
                    {m.attachments.filter((a) => a.mime.startsWith("image/")).map((a) => (
                      <a key={a.id} href={`/comunicacion/adjunto/${a.id}`} target="_blank" rel="noreferrer" className="ci-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/comunicacion/adjunto/${a.id}`} alt={a.name} />
                      </a>
                    ))}
                    {m.body && <p>{m.body}</p>}
                    <span className="meta">{m.authorName} · {when(m.sentAt)}</span>
                  </div>
                ))}
              </div>

              <div className="ci-reply">
                <div className="ci-reply-h"><span className="k"><Spark s={11} /> {t("Respuesta sugerida", "Suggested reply")}</span><span className="src">{t("Edítala antes de enviar", "Edit before sending")}</span></div>
                <form action={sendReply.bind(null, th.id)} className="qa-form">
                  <textarea key={draft} name="body" rows={6} defaultValue={draft} aria-label={t("Respuesta", "Reply")} />
                  <div className="qa-row">
                    {th.channel === "EMAIL" && (th.partyAddr || th.contact?.email) && graph && (
                      <button type="submit" name="how" value="email">{t("Enviar desde el correo de la empresa", "Send from company email")}</button>
                    )}
                    {th.channel === "WHATSAPP" && phone && (
                      <a className="btn sm" href={`https://wa.me/${phone}?text=${encodeURIComponent(draft)}`} target="_blank" rel="noreferrer">{t("Abrir WhatsApp con este texto", "Open WhatsApp with this text")}</a>
                    )}
                    <button type="submit" name="how" value="log" className="secondary">{th.channel === "EMAIL" ? t("Ya respondí por otro medio", "I replied another way") : t("Marcar como enviada", "Mark as sent")}</button>
                  </div>
                </form>
              </div>

              <div className="qa-bar">
                <QA label={t("+ Mensaje en este hilo", "+ Message in this thread")} wide><RegisterForm threadId={th.id} /></QA>
                <QA label={t("Agendar el trabajo", "Schedule the work")} wide>
                  <form action={reserveTime} className="qa-form">
                    <input type="hidden" name="back" value={`/comunicacion?t=${th.id}`} />
                    {th.dealId && <input type="hidden" name="dealId" value={th.dealId} />}
                    <label>{t("Qué vas a hacer", "What you'll do")}<input name="title" defaultValue={`${t("Cotizar y responder a", "Quote and reply to")} ${firstName}${live.find((x) => x.field === "product") ? ` · ${live.find((x) => x.field === "qty")?.value ?? ""} ${live.find((x) => x.field === "product")!.value}` : ""}`.replace(/\s+/g, " ").trim()} required /></label>
                    <div className="qa-row">
                      <input name="date" type="date" defaultValue={new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10)} required />
                      <input name="time" type="time" defaultValue="10:00" step={900} required />
                      <select name="minutes" defaultValue="30" aria-label={t("Duración", "Duration")}>{[15, 30, 45, 60, 90].map((x) => <option key={x} value={x}>{x} min</option>)}</select>
                    </div>
                    <span className="src">{user.outlookConnectedAt ? t("Queda en Mi Día y en tu Outlook.", "Goes to My Day and your Outlook.") : t("Queda en Mi Día.", "Goes to My Day.")}</span>
                    <button type="submit">{t("Reservar tiempo", "Reserve time")}</button>
                  </form>
                </QA>
                {!th.closedAt && <form action={closeThread.bind(null, th.id)}><button type="submit" className="qa-btn">{t("Nada más que hacer aquí", "Nothing more to do here")}</button></form>}
              </div>
            </>
          )}
        </section>

        {/* ---------- 3. SOLU understood ---------- */}
        <aside className="ci-zone ci-und" aria-label={t("SOLU entendió", "SOLU understood")}>
          <div className="ci-zh"><b className="ai-t"><Spark /> {t("SOLU ENTENDIÓ", "SOLU UNDERSTOOD")}</b></div>
          {!th ? null : !th.accountId ? (
            <div className="stack">
              <p className="quiet-p">{t("No sé de qué cliente es. Vincúlalo para que SOLU use su historial.", "I don't know which customer this is. Link it so SOLU can use their history.")}</p>
              <form action={linkContact.bind(null, th.id)} className="qa-form">
                <select name="contactId" required defaultValue=""><option value="" disabled>{t("Contacto…", "Contact…")}</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}{c.account ? ` · ${strip(c.account.name)}` : ""}</option>)}</select>
                <button type="submit" className="secondary">{t("Vincular", "Link")}</button>
              </form>
            </div>
          ) : live.length === 0 ? (
            <p className="quiet-p">{t("No encontré un pedido o necesidad en esta conversación.", "I found no request or need in this conversation.")}</p>
          ) : (
            <>
              {facts.length > 0 && <span className="ci-sec">{t("Lo que dijo el cliente", "What the customer said")}</span>}
              {facts.map((x) => <ItemRow key={x.id} x={x} />)}
              {inferences.length > 0 && <span className="ci-sec">{t("Lo que SOLU deduce", "What SOLU infers")}</span>}
              {inferences.map((x) => <ItemRow key={x.id} x={x} />)}
              {missing.length > 0 && (
                <div className="ci-missing">
                  <span className="k">{t("Falta para cotizar con seguridad", "Missing to quote with confidence")}</span>
                  <ul>{missing.map((m) => <li key={m.field}>{i.es ? m.es : m.en}</li>)}</ul>
                  <span className="src">{t("La respuesta sugerida ya pregunta esto.", "The suggested reply already asks for this.")}</span>
                </div>
              )}
              {ctaValue ? (
                <form action={applyToJourney.bind(null, th.id)} className="ci-cta">
                  <label>{t("Llevar a", "Take to")}
                    <select name="dealId" defaultValue={defaultDeal}>
                      <option value="new">{t("Nuevo Journey", "New Journey")}</option>
                      {openDeals.map((d) => <option key={d.id} value={d.id}>{d.code ?? ""} {d.title}</option>)}
                    </select>
                  </label>
                  <button type="submit" className="wide">
                    {proposed.length > 0
                      ? t(`Confirmar ${proposed.length === 1 ? "la inferencia" : `las ${proposed.length} inferencias`} y guardar en el Journey`, `Confirm ${proposed.length === 1 ? "the inference" : `the ${proposed.length} inferences`} and save to the Journey`)
                      : t("Guardar la necesidad en el Journey", "Save the need to the Journey")}
                  </button>
                  <span className="src">{t("Queda como hecho confirmado, con la conversación como fuente. Lo que descartes no se guarda.", "It's saved as a confirmed fact, with the conversation as its source. Anything you discard isn't saved.")}</span>
                </form>
              ) : th.deal ? (
                <p className="ci-done">✓ {t("Todo confirmado y guardado en", "All confirmed and saved in")} <Link href={`/deals/${th.deal.id}`}>{th.deal.code ?? th.deal.title}</Link></p>
              ) : null}
              <p className="src ci-scope">{t("SOLU todavía no lee fotos ni usa IA: lo que ves sale de reglas simples sobre el texto y del historial del cliente.", "SOLU doesn't read photos or use AI yet: this comes from simple rules over the text and the customer's history.")}</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
