import Link from "next/link";
import { db } from "@/lib/db";
import { aiConfigured, aiSpentThisMonth, monthlyCap } from "@/lib/ai";
import { LeadMailLink, WebLeadCard } from "@/components/WebLeadCard";
import { HuntForm } from "@/components/HuntForm";
import { HUNT_STALE_MS, contactNote, leadsMailedAt } from "@/lib/web-hunt";
import { leadAsSource, unsaveLead } from "@/app/(app)/localizar/internet/actions";

type T = (es: string, en: string) => string;

/** The internet search inside the Need itself (owner, 2026-11-26: "you should not have to go every time to mercado
 *  to locate"): the questions and the button are here, with the searches already made for this Need and the sellers
 *  saved on it. From here one of them becomes the Need's source. */
export async function NeedWebLeads({ dealId, t, n2, day, editable, tab, searchFor, qty, ok, err, n }: {
  dealId: string; t: T; n2: (v: number) => string; day: (d: Date) => string; editable: boolean; tab: "locate" | "source"; searchFor: string; qty?: number | null; ok?: string; err?: string; n?: string;
}) {
  const [leads, hunts, spent] = await Promise.all([
    db.webLead.findMany({ where: { dealId }, orderBy: [{ sourceAt: { sort: "desc", nulls: "last" } }, { savedAt: "asc" }], include: { supplier: { select: { id: true, name: true } } } }),
    db.webHunt.findMany({ where: { dealId, status: { in: ["DONE", "RUNNING"] } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, query: true, status: true, userName: true, createdAt: true, _count: { select: { leads: true } } } }),
    aiSpentThisMonth(),
  ]);
  const cNote = contactNote(ok, err, n, t);
  const mailed = await leadsMailedAt(leads.map((l) => l.id));
  const cap = monthlyCap();
  const aiState = !aiConfigured() ? "OFF" : spent.usd + 0.1 > cap ? "CAP" : "ON";
  const live = hunts.filter((h) => h.status === "DONE" || Date.now() - h.createdAt.getTime() < HUNT_STALE_MS);
  return (
    <section className="jblock" id="internet">
      <div className="jbh"><b>{t("BUSCAR LA PIEZA EN INTERNET", "SEARCH THE INTERNET FOR THE PIECE")}</b><span className="grow" /><span className="src">{t("quién la vende hoy, con enlace directo y contacto", "who sells it today, with direct link and contact")}</span></div>
      {ok === "fuente-internet" && <p className="note okn" role="status">{t("Listo: esa opción quedó como la fuente de esta Necesidad y el vendedor quedó registrado como proveedor. Falta confirmar con él precio, existencia y plazo, y escribir el costo abajo.", "Done: that option is now this Need's source and the seller is on file as a supplier. Price, stock and lead time still have to be confirmed with them, and the cost typed below.")}</p>}
      {ok === "internet-quitada" && <p className="note" role="status">{t("Opción quitada de esta Necesidad. Sigue en el resultado de la búsqueda.", "Option removed from this Need. It is still in the search result.")}</p>}
      {cNote && <p className={`note ${cNote.good ? "okn" : "attn"}`} role={cNote.good ? "status" : "alert"}>{cNote.text}</p>}
      {err === "permiso-internet" && <p className="note attn" role="alert">{t("Solo el dueño de esta Necesidad, Gerencia o el Director Comercial pueden cambiar sus opciones.", "Only this Need's owner, Management or the Commercial Director can change its options.")}</p>}

      {live.length > 0 && (
        <ul className="plain wl-prev">
          {live.map((h) => (
            <li key={h.id}>
              <Link href={`/localizar/internet/${h.id}`}>{h.status === "RUNNING" ? t("Hay una búsqueda en curso: ver cómo va", "A search is running: see how it is going") : t(`Ver los ${h._count.leads} vendedor(es) encontrados`, `See the ${h._count.leads} seller(s) found`)} →</Link>{" "}
              <span className="src">«{h.query}» · {h.userName} · {day(h.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <details className="qa" open={tab === "locate" && live.length === 0 && leads.length === 0}>
        <summary className="qa-btn">{live.length === 0 && leads.length === 0 ? t("Buscar esta pieza en internet", "Search the internet for this piece") : t("Buscar más opciones en internet", "Search the internet for more options")}</summary>
        <p className="src" style={{ margin: "8px 0" }}>{t("SOLU busca vendedores de la pieza, comprueba el número de parte en cada página y los entrega por nivel de confianza. Revisa lo que se va a buscar: si la Necesidad tiene varios números, deja uno solo. Ninguna otra pregunta es obligatoria.", "SOLU searches for sellers of the piece, checks the part number on each page and hands them back by confidence level. Check what will be searched: if the Need has several numbers, leave just one. No other question is required.")}</p>
        <HuntForm t={t} q={searchFor} dealId={dealId} fixedDeal needs={[]} answers={qty ? { qty: String(qty) } : undefined} showQuery state={aiState} cap={cap} />
      </details>

      {leads.length > 0 && (
        <>
          <div className="jbh" style={{ marginTop: 14 }}><b>{t("OPCIONES GUARDADAS EN ESTA NECESIDAD", "OPTIONS SAVED ON THIS NEED")}</b><span className="grow" /><span className="sig info">{leads.length}</span></div>
          <div className="loc-list">
            {leads.map((l) => (
              <WebLeadCard key={l.id} l={l} t={t} n2={n2} mailedAt={mailed.get(l.id)} day={day} from={`deal:${tab}`}>
                <div className="wl-save">
                  {l.supplier ? (
                    <span><span className="sig ok">{t("Es la fuente de esta Necesidad", "It is this Need's source")}</span> <Link href={`/suppliers/${l.supplier.id}`}>{t(`Abrir el proveedor ${l.supplier.name}`, `Open supplier ${l.supplier.name}`)}</Link></span>
                  ) : editable ? (
                    <form action={leadAsSource.bind(null, l.id)}><button type="submit">{t("Usar como fuente", "Use as source")}</button></form>
                  ) : null}
                  <LeadMailLink id={l.id} t={t} again={mailed.has(l.id)} />
                  <span className="src">{t(`Guardada por ${l.savedByName ?? "—"}${l.savedAt ? ` el ${day(l.savedAt)}` : ""}`, `Saved by ${l.savedByName ?? "—"}${l.savedAt ? ` on ${day(l.savedAt)}` : ""}`)} · <Link href={`/localizar/internet/${l.huntId}#l-${l.id}`}>{t("ver la búsqueda completa", "see the whole search")}</Link></span>
                  <span className="grow" />
                  {editable && <form action={unsaveLead.bind(null, l.id)}><input type="hidden" name="tab" value={tab} /><button type="submit" className="link small">{t("Quitar de esta Necesidad", "Remove from this Need")}</button></form>}
                </div>
              </WebLeadCard>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
