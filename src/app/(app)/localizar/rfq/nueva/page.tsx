import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { mailConfig } from "@/lib/mail";
import { evidenceFor, partKey } from "@/lib/parts";
import { rfqEmail } from "@/lib/rfq";
import { fold } from "@/lib/part-lexicon";
import { createRfq } from "../../ofertas/actions";

export default async function NewRfq({ searchParams }: { searchParams: Promise<{ part?: string | string[]; deal?: string; err?: string }> }) {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const sp = await searchParams;
  const ids = (Array.isArray(sp.part) ? sp.part : sp.part ? [sp.part] : []).slice(0, 30);
  const deal = sp.deal ? await db.deal.findUnique({ where: { id: sp.deal }, select: { id: true, code: true, title: true, items: { select: { code: true, qty: true } } } }) : null;
  // From a Journey, offer its other product codes that are in the catalog.
  const dealKeys = (deal?.items ?? []).filter((x) => x.code).map((x) => ({ k: partKey(x.code!), qty: x.qty }));
  const [chosen, fromDeal, suppliers, offersBy] = await Promise.all([
    db.part.findMany({ where: { id: { in: ids } }, select: { id: true, mpn: true, name: true, nameEn: true, brand: true } }),
    dealKeys.length ? db.part.findMany({ where: { mpnKey: { in: dealKeys.map((d) => d.k) }, mergedIntoId: null }, select: { id: true, mpn: true, name: true, nameEn: true, brand: true, mpnKey: true } }) : [],
    db.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, country: true }, take: 500 }),
    db.supplierOffer.findMany({ where: { partId: { in: ids } }, select: { supplierId: true } }),
  ]);
  const parts = [...chosen, ...fromDeal.filter((p) => !ids.includes(p.id))];
  const qtyFor = (p: { id: string; mpnKey?: string }) => (p.mpnKey ? dealKeys.find((d) => d.k === p.mpnKey)?.qty : undefined) ?? 1;
  const ev = await evidenceFor(parts.map((p) => p.id));
  // Suppliers worth asking first: those who sold or quoted these parts, then those whose name has the brand.
  const sold = new Set([...ev.values()].flatMap((e) => (e.lastCost ? [e.lastCost.supplierId] : [])));
  offersBy.forEach((o) => sold.add(o.supplierId));
  const brands = [...new Set(parts.map((p) => p.brand).filter(Boolean))].map((b) => fold(b!));
  const rank = (s: { id: string; name: string }) => (sold.has(s.id) ? 0 : brands.some((b) => fold(s.name).includes(b)) ? 1 : 2);
  const sorted = [...suppliers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const cfg = mailConfig();
  const preview = parts.length ? rfqEmail({ code: "RFQ-…", lang: "EN", supplierName: t("[proveedor]", "[supplier]"), items: parts.map((p) => ({ partId: p.id, mpn: p.mpn, name: p.name, nameEn: p.nameEn, brand: p.brand, qty: qtyFor(p) })), neededBy: null, notes: null, senderName: user.name, from: cfg.from ?? "sales@indsolusa.com" }) : null;
  const errs: Record<string, string> = {
    partes: t("Elige al menos una parte.", "Pick at least one part."),
    proveedores: t("Elige al menos un proveedor.", "Pick at least one supplier."),
    sincorreo: t("Ninguno de los proveedores elegidos tiene correo. Agrégalo en Proveedores.", "None of the chosen suppliers has an email. Add it in Suppliers."),
    correo: t("El correo de la empresa no está configurado.", "Company email isn't configured."),
  };

  return (
    <>
      <div className="ph">
        <div>
          <div className="crumb"><Link href="/localizar">{t("Localizar repuestos", "Find parts")}</Link></div>
          <h1>{t("Pedir cotización a proveedores", "Request quotes from suppliers")}</h1>
          <p>{t(`Sale desde ${cfg.from ?? "sales@"}: un correo separado a cada proveedor (no se ven entre ellos). No incluye el nombre del cliente ni nuestro precio.`, `Sent from ${cfg.from ?? "sales@"}: a separate email to each supplier (they don't see each other). It never includes the customer's name or our price.`)}</p>
        </div>
      </div>
      {sp.err && errs[sp.err] && <p className="note attn">{errs[sp.err]}</p>}
      {deal && <div className="loc-ctx"><span>{t(`Para el Journey ${deal.code ?? ""} · ${deal.title}`, `For Journey ${deal.code ?? ""} · ${deal.title}`)}</span></div>}
      {parts.length === 0 ? (
        <div className="card"><p>{t("Primero busca la parte en ", "First find the part in ")}<Link href="/localizar">{t("Localizar repuestos", "Find parts")}</Link>{t(" y usa “Pedir precio a proveedor”.", " and use “Ask a supplier for a price”.")}</p></div>
      ) : (
        <form action={createRfq} className="stack">
          {deal && <input type="hidden" name="dealId" value={deal.id} />}
          <section className="jblock loc-sec">
            <div className="jbh"><b>{t("QUÉ PEDIMOS", "WHAT WE ASK FOR")}</b></div>
            <table>
              <thead><tr><th /><th>{t("Parte", "Part")}</th><th className="n">{t("Cantidad", "Qty")}</th></tr></thead>
              <tbody>{parts.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" name="partId" value={p.id} defaultChecked={ids.includes(p.id) || !ids.length} /></td>
                  <td><span className="mono">{p.mpn}</span> · {p.name}{p.brand ? <span className="src"> · {p.brand}</span> : null}</td>
                  <td className="n"><input name={`qty_${p.id}`} type="number" min="1" defaultValue={qtyFor(p)} style={{ width: 80 }} /></td>
                </tr>
              ))}</tbody>
            </table>
          </section>

          <section className="jblock loc-sec">
            <div className="jbh"><b>{t("A QUIÉN", "TO WHOM")}</b><span className="grow" /><span className="src">{t("primero los que ya nos la vendieron o cotizaron", "first those who sold or quoted it before")}</span></div>
            <div className="loc-sups">
              {sorted.map((s) => {
                const r = rank(s);
                return (
                  <label key={s.id} className={`loc-sup${s.email ? "" : " off"}`}>
                    <input type="checkbox" name="supplierId" value={s.id} disabled={!s.email} defaultChecked={r === 0 && !!s.email} />
                    <span><b>{s.name}</b>{r === 0 && <span className="loc-chip">{t("ya nos la vendió/cotizó", "sold/quoted before")}</span>}{r === 1 && <span className="loc-chip">{t("misma marca", "same brand")}</span>}
                      <span className="src block">{s.email ?? <>{t("sin correo · ", "no email · ")}<Link href="/suppliers">{t("agregar", "add")}</Link></>}{s.country ? ` · ${s.country}` : ""}</span></span>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="jblock loc-sec">
            <div className="jbh"><b>{t("DETALLES", "DETAILS")}</b></div>
            <div className="loc-docgrid">
              <label>{t("Respuesta antes de", "Answer by")}<input type="date" name="neededBy" /></label>
              <label>{t("Idioma del correo", "Email language")}<select name="lang" defaultValue="AUTO"><option value="AUTO">{t("Según el país del proveedor", "By supplier's country")}</option><option value="EN">English</option><option value="ES">Español</option></select></label>
            </div>
            <label>{t("Nota para el proveedor (opcional)", "Note for the supplier (optional)")}<textarea name="notes" rows={2} placeholder={t("Ej.: necesitamos certificado de origen", "E.g.: we need a certificate of origin")} /></label>
          </section>

          {preview && (
            <details className="loc-preview"><summary>{t("Ver cómo se verá el correo (inglés)", "Preview the email (English)")}</summary>
              <p className="mono small"><b>{preview.subject}</b></p>
              <pre>{preview.text}</pre>
            </details>
          )}
          <div><button type="submit">{t("Enviar solicitud", "Send request")}</button></div>
        </form>
      )}
    </>
  );
}
