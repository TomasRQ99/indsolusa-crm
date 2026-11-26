import type { ReactNode } from "react";
import { closedText, confidenceLabel, kindLabel, reasonText } from "@/lib/web-hunt";

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
export function WebLeadCard({ l, t, n2, children }: { l: WebLeadView; t: T; n2: (v: number) => string; children?: ReactNode }) {
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
          {l.contactFrom === "PAGE" && <span className="src"> {t("leído por SOLU en la página", "read by SOLU on the page")}</span>}
        </dd>
        {l.note && <><dt>{t("Nota", "Note")}</dt><dd>{l.note}</dd></>}
      </dl>
      {children}
    </article>
  );
}
