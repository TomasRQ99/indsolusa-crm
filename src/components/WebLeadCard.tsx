import type { ReactNode } from "react";
import { closedText, confidenceLabel, kindLabel, reasonText } from "@/lib/web-hunt";
import { findLeadContact, setLeadContact } from "@/app/(app)/localizar/internet/actions";

export type WebLeadView = {
  id: string; seller: string; sellerKind: string; country: string | null; url: string; host: string; title: string | null;
  confidence: string; reasons: string[]; evidence: string | null; mpnSeen: string | null;
  price: unknown; currency: string | null; availability: string | null; condition: string | null;
  email: string | null; phone: string | null; contactUrl: string | null; contactFrom: string | null; note: string | null;
  checked: string | null; checkedWhy: string | null;
};

type T = (es: string, en: string) => string;
const TONE: Record<string, string> = { HIGH: "ok", MEDIUM: "attn", LOW: "wait" };

/** One seller found on the internet: who it is, how sure SOLU is and why, the direct link, and how to reach them. */
export function WebLeadCard({ l, t, n2, mailedAt, day, from = "hunt", openContact, children }: { l: WebLeadView; t: T; n2: (v: number) => string; mailedAt?: Date | null; day?: (d: Date) => string; from?: string; openContact?: boolean; children?: ReactNode }) {
  const cond = l.condition === "REFURBISHED" ? t("reacondicionada", "refurbished") : l.condition === "USED" ? t("usada", "used") : l.condition === "NEW" ? t("nueva", "new") : null;
  return (
    <article className={`wl wl-${l.confidence.toLowerCase()}`} id={`l-${l.id}`}>
      <div className="wl-top">
        <b className="wl-seller">{l.seller}</b>
        <span className="loc-chip">{kindLabel(l.sellerKind, t)}</span>
        {l.country && <span className="src">{l.country}</span>}
        <span className="grow" />
        <span className={`sig ${TONE[l.confidence] ?? "wait"}`}>{confidenceLabel(l.confidence, t)}</span>
      </div>
      {l.title && <div className="wl-title">{l.title}</div>}
      <ul className="loc-why">
        {l.reasons.map((r) => <li key={r}>{reasonText(r, t)}</li>)}
        {l.checked === "CLOSED" && <li>{t(`SOLU no pudo abrir la página por su cuenta (${closedText(l.checkedWhy, t)}).`, `SOLU could not open the page on its own (${closedText(l.checkedWhy, t)}).`)}</li>}
      </ul>
      {l.evidence && <p className="wl-ev"><span className="src">{t("Lo que leyó la IA", "What the AI read")}:</span> {l.evidence}</p>}
      <dl className="qv-dl wl-dl">
        <dt>{t("Enlace directo", "Direct link")}</dt>
        <dd><a href={l.url} target="_blank" rel="noopener noreferrer nofollow">{t("Ver la pieza en el sitio del vendedor", "See the piece on the seller's site")} ↗</a> <span className="src">{l.host}</span></dd>
        {l.mpnSeen && <><dt>{t("Número en la página", "Number on the page")}</dt><dd className="mono">{l.mpnSeen}</dd></>}
        {(l.price != null || l.availability || cond) && (
          <><dt>{t("Visto en la página", "Seen on the page")}</dt>
            <dd>{[l.price != null ? `${l.currency ?? ""} ${n2(Number(l.price))}`.trim() : null, l.availability, cond].filter(Boolean).join(" · ")} <span className="src">{t("referencia, no es una oferta: confírmalo con el vendedor", "a reference, not an offer: confirm it with the seller")}</span></dd></>
        )}
        <dt>{t("Contacto", "Contact")}</dt>
        <dd>
          {l.email && <a href={`mailto:${l.email}`}>{l.email}</a>}
          {l.email && l.phone && " · "}
          {l.phone && <a href={`tel:${l.phone.replace(/[^+\d]/g, "")}`}>{l.phone}</a>}
          {(l.email || l.phone) && l.contactUrl && " · "}
          {l.contactUrl && <a href={l.contactUrl} target="_blank" rel="noopener noreferrer nofollow">{t("Formulario de contacto", "Contact form")} ↗</a>}
          {!l.email && !l.phone && !l.contactUrl && <span className="muted">{t("No se vio correo, teléfono ni formulario: búscalo en el enlace directo.", "No email, phone or form was seen: look for it on the direct link.")}</span>}
          {l.contactFrom === "PAGE" && <span className="src"> {t("leído por SOLU en el sitio del vendedor", "read by SOLU on the seller's site")}</span>}
          {l.contactFrom === "MANUAL" && <span className="src"> {t("escrito por el equipo", "typed by the team")}</span>}
          {(!l.email || !l.phone) && (
            <details className="wl-contact" open={openContact}>
              <summary className="link small">{l.email || l.phone ? t("Completar el contacto", "Complete the contact") : t("Buscar o escribir el contacto", "Find or type the contact")}</summary>
              <form action={setLeadContact.bind(null, l.id)} className="wl-contact-f">
                <input type="hidden" name="from" value={from} />
                <label>{t("Correo del vendedor", "Seller's email")}<input name="email" type="text" inputMode="email" maxLength={120} defaultValue={l.email ?? ""} autoComplete="off" /></label>
                <label>{t("Teléfono", "Phone")}<input name="phone" type="text" inputMode="tel" maxLength={40} defaultValue={l.phone ?? ""} autoComplete="off" /></label>
                <button type="submit" className="secondary sm">{t("Guardar contacto", "Save contact")}</button>
                <button type="submit" className="secondary sm" formAction={findLeadContact.bind(null, l.id)} formNoValidate>{t("Buscar en el sitio del vendedor", "Search the seller's site")}</button>
              </form>
              <span className="src">{t("«Buscar en el sitio del vendedor» abre su página de contacto y su página principal y toma el correo y el teléfono que estén escritos ahí. No usa IA ni cuesta. Si el sitio no deja leer, abre el enlace directo y escribe aquí lo que veas.", "“Search the seller's site” opens their contact page and home page and takes the email and phone written there. It uses no AI and costs nothing. If the site does not allow reading, open the direct link and type here what you see.")}</span>
            </details>
          )}
        </dd>
        {l.note && <><dt>{t("Nota", "Note")}</dt><dd>{l.note}</dd></>}
      </dl>
      <p className="wl-mail">
        <a className="btn secondary sm" href={`/correo/nuevo?tpl=SELLER&id=${l.id}`}>{t("Escribirle al vendedor", "Email the seller")}</a>{" "}
        {mailedAt
          ? <span className="sig ok">{t(`Correo enviado${day ? ` el ${day(mailedAt)}` : ""}`, `Email sent${day ? ` on ${day(mailedAt)}` : ""}`)}</span>
          : <span className="src">{l.email ? t("abre el correo ya escrito con la pieza, para revisarlo antes de enviar", "opens the email already written with the piece, to review before sending") : t("no se vio su correo: el texto sale listo para pegarlo en su formulario de contacto", "their email was not seen: the text comes ready to paste into their contact form")}</span>}
      </p>
      {children}
    </article>
  );
}
