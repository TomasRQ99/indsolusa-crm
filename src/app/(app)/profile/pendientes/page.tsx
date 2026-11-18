import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { makeI18n } from "@/lib/i18n";
import { pendingFor, type PendingRow } from "@/lib/pending";

// Mi perfil → Pendientes por aprobar: what waits for my decision, each line with a button that opens the exact
// place where it is decided; and what I asked for that waits for someone else.

export default async function PendingPage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const { mine, waiting } = await pendingFor(user);
  const kinds = [...new Map(mine.map((r) => [r.kind.es, r.kind])).values()];

  const Row = ({ r, n }: { r: PendingRow; n?: number }) => (
    <li className={`pd-row${r.waitsFor ? " wait" : ""}`}>
      {n != null && <span className="pd-n" aria-hidden>{n}</span>}
      <span className="pd-t">
        <b>{t(r.title.es, r.title.en)}</b>
        {r.detail && t(r.detail.es, r.detail.en) && <span className="pd-d">{t(r.detail.es, r.detail.en)}</span>}
        <span className="src">{[r.amount, r.since ? t(`desde el ${i.day(r.since)}`, `since ${i.day(r.since)}`) : null].filter(Boolean).join(" · ")}</span>
        {r.waitsFor && <span className="pd-w">{t(r.waitsFor.es, r.waitsFor.en)}</span>}
      </span>
      <a className={`btn${r.waitsFor ? " secondary" : ""}`} href={r.href}>{t(r.cta.es, r.cta.en)} →</a>
    </li>
  );

  return (
    <>
      <div className="ph"><div>
        <div className="crumb"><Link href="/profile">{t("Mi perfil", "My profile")}</Link></div>
        <h1>{t("Pendientes por aprobar", "Pending approvals")}</h1>
        <p>{t("Todo lo que espera una decisión tuya, en un solo lugar. Cada línea tiene un botón que te lleva al sitio exacto donde se aprueba.", "Everything that waits for a decision of yours, in one place. Each line has a button that takes you to the exact place where it is approved.")}</p>
      </div></div>

      <section className="card">
        <h2>{t("Lo que tú debes decidir", "What you must decide")} <span className={`sig ${mine.length ? "attn" : "ok"}`}>{mine.length ? mine.length : t("Nada pendiente", "Nothing pending")}</span></h2>
        {mine.length === 0 ? <p className="small muted">{t("No hay nada esperando tu aprobación. Cuando alguien pida una autorización, o una orden esté lista para aceptar o liberar, aparece aquí.", "Nothing is waiting for your approval. When someone requests an authorization, or an order is ready to accept or release, it shows here.")}</p> : (
          kinds.map((k) => {
            const rows = mine.filter((r) => r.kind.es === k.es);
            return (
              <div key={k.es} className="pd-group">
                <h3>{t(k.es, k.en)} <span className="src">({rows.length})</span></h3>
                <ol className="pd-list">{rows.map((r, n) => <Row key={r.key} r={r} n={n + 1} />)}</ol>
              </div>
            );
          })
        )}
      </section>

      {waiting.length > 0 && (
        <section className="card">
          <h2>{t("Lo que pediste y espera a otra persona", "What you asked for and waits for someone else")} <span className="sig wait">{waiting.length}</span></h2>
          <p className="small muted">{t("Aquí no verás el botón de aprobar: quien pide no aprueba. Se muestra para que sepas en qué va.", "You will not see an approve button here: whoever asks does not approve. It is shown so you know where it stands.")}</p>
          <ol className="pd-list">{waiting.map((r) => <Row key={r.key} r={r} />)}</ol>
        </section>
      )}
    </>
  );
}
