import Link from "next/link";
import { db } from "@/lib/db";
import { WebLeadCard } from "@/components/WebLeadCard";
import { leadAsSource, unsaveLead } from "@/app/(app)/localizar/internet/actions";

type T = (es: string, en: string) => string;

/** The sellers found on the internet and saved on this Need. From here one of them becomes the Need's source. */
export async function NeedWebLeads({ dealId, t, n2, day, editable, tab, searchFor, ok, err }: {
  dealId: string; t: T; n2: (v: number) => string; day: (d: Date) => string; editable: boolean; tab: "locate" | "source"; searchFor: string; ok?: string; err?: string;
}) {
  const leads = await db.webLead.findMany({ where: { dealId }, orderBy: [{ sourceAt: { sort: "desc", nulls: "last" } }, { savedAt: "asc" }], include: { supplier: { select: { id: true, name: true } } } });
  const searchHref = `/localizar?${new URLSearchParams({ ...(searchFor ? { q: searchFor } : {}), deal: dealId })}#internet`;
  return (
    <section className="jblock" id="internet">
      <div className="jbh"><b>{t("OPCIONES ENCONTRADAS EN INTERNET", "OPTIONS FOUND ON THE INTERNET")}</b><span className="grow" />{leads.length > 0 && <span className="sig info">{leads.length}</span>}</div>
      {ok === "fuente-internet" && <p className="note okn" role="status">{t("Listo: esa opción quedó como la fuente de esta Necesidad y el vendedor quedó registrado como proveedor. Falta confirmar con él precio, existencia y plazo, y escribir el costo abajo.", "Done: that option is now this Need's source and the seller is on file as a supplier. Price, stock and lead time still have to be confirmed with them, and the cost typed below.")}</p>}
      {ok === "internet-quitada" && <p className="note" role="status">{t("Opción quitada de esta Necesidad. Sigue en el resultado de la búsqueda.", "Option removed from this Need. It is still in the search result.")}</p>}
      {err === "permiso-internet" && <p className="note attn" role="alert">{t("Solo el dueño de esta Necesidad, Gerencia o el Director Comercial pueden cambiar sus opciones.", "Only this Need's owner, Management or the Commercial Director can change its options.")}</p>}
      {leads.length === 0 ? (
        <p className="quiet-p">{t("Todavía no hay opciones de internet guardadas en esta Necesidad. SOLU puede buscar quién vende la pieza, con enlace directo y contacto.", "No internet options are saved on this Need yet. SOLU can search for who sells the piece, with direct link and contact.")}</p>
      ) : (
        <div className="loc-list">
          {leads.map((l) => (
            <WebLeadCard key={l.id} l={l} t={t} n2={n2}>
              <div className="wl-save">
                {l.supplier ? (
                  <span><span className="sig ok">{t("Es la fuente de esta Necesidad", "It is this Need's source")}</span> <Link href={`/suppliers/${l.supplier.id}`}>{t(`Abrir el proveedor ${l.supplier.name}`, `Open supplier ${l.supplier.name}`)}</Link></span>
                ) : editable ? (
                  <form action={leadAsSource.bind(null, l.id)}><button type="submit">{t("Usar como fuente", "Use as source")}</button></form>
                ) : null}
                <span className="src">{t(`Guardada por ${l.savedByName ?? "—"}${l.savedAt ? ` el ${day(l.savedAt)}` : ""}`, `Saved by ${l.savedByName ?? "—"}${l.savedAt ? ` on ${day(l.savedAt)}` : ""}`)} · <Link href={`/localizar/internet/${l.huntId}#l-${l.id}`}>{t("ver la búsqueda completa", "see the whole search")}</Link></span>
                <span className="grow" />
                {editable && <form action={unsaveLead.bind(null, l.id)}><input type="hidden" name="tab" value={tab} /><button type="submit" className="link small">{t("Quitar de esta Necesidad", "Remove from this Need")}</button></form>}
              </div>
            </WebLeadCard>
          ))}
        </div>
      )}
      <p className="small" style={{ marginTop: 10 }}>
        <Link className="qa-btn" href={searchHref}>{leads.length === 0 ? t("Buscar esta pieza en internet", "Search the internet for this piece") : t("Buscar más opciones en internet", "Search the internet for more options")}</Link>{" "}
        <span className="src">{t("abre Localizar repuestos con esta Necesidad ya elegida", "opens Find parts with this Need already picked")}</span>
      </p>
    </section>
  );
}
