import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { canManageAll } from "@/lib/permissions";
import { makeI18n } from "@/lib/i18n";
import { buildQuote, futureZone, quoteInclude, quoteNo } from "@/lib/quote";
import { quoteFloors } from "@/lib/esagara-gate";

// Commercial Future: open quotes grouped by what they need from the person, never by amount or probability.
export default async function CommercialFuturePage() {
  const user = await requireUser();
  const i = makeI18n(user.lang);
  const { t } = i;
  const quotes = await db.quote.findMany({
    where: { status: { in: ["DRAFT", "PRESENTED"] }, ...(canManageAll(user) ? {} : { deal: { ownerId: user.id } }) },
    include: quoteInclude,
    orderBy: { createdAt: "desc" },
  });

  const floors = await quoteFloors(quotes.map((q) => q.id));
  type Row = { q: (typeof quotes)[number]; b: ReturnType<typeof buildQuote>; zone: "today" | "window" | "waiting" | "clarity"; line: string };
  const rows: Row[] = quotes.map((q) => {
    const b = buildQuote(q, i, { version: floors.version, floorPct: floors.floor(q.id), threshold: floors.threshold });
    if (q.status === "DRAFT") {
      return b.blocking.length === 0
        ? { q, b, zone: "today" as const, line: t("Lista para presentar", "Ready to present") }
        : { q, b, zone: "clarity" as const, line: t(`Para presentar falta: ${b.blocking[0].text.toLowerCase()}${b.blocking.length > 1 ? ` (+${b.blocking.length - 1})` : ""}`, `To present: ${b.blocking[0].text.toLowerCase()}${b.blocking.length > 1 ? ` (+${b.blocking.length - 1})` : ""}`) };
    }
    return { q, b, zone: futureZone(b) ?? "clarity", line: b.next?.title ?? "" };
  });

  const zones: { key: Row["zone"]; title: string; hint: string }[] = [
    { key: "today", title: t("VALE LA PENA MOVER HOY", "WORTH MOVING TODAY"), hint: t("Una acción hoy cambia el resultado.", "An action today changes the result.") },
    { key: "window", title: t("VENTANAS DE DECISIÓN CERCANAS", "DECISION WINDOWS APPROACHING"), hint: t("El cliente decide en los próximos días.", "The customer decides in the next few days.") },
    { key: "waiting", title: t("ESPERANDO CON CONTROL", "WAITING WITH CONTROL"), hint: t("Nada que hacer hoy. SOLU vigila y avisa.", "No action today. SOLU watches and warns.") },
    { key: "clarity", title: t("FUTURO QUE NECESITA CLARIDAD", "FUTURE NEEDS CLARITY"), hint: t("Falta saber algo para poder actuar.", "Something must be found out before acting.") },
  ];

  return (
    <div className="qlist">
      <div>
        <h1>{t("Futuro comercial", "Commercial future")}</h1>
        <p className="src">{t("Cotizaciones abiertas según lo que necesitan de ti. Sin probabilidades de cierre inventadas.", "Open quotes by what they need from you. No invented close probabilities.")}</p>
      </div>
      {rows.length === 0 && <p className="quiet-p">{t("No hay cotizaciones abiertas. Se crean desde la pestaña Cotización de cada Journey.", "No open quotes. Create them from each Journey's Quote tab.")}</p>}
      {zones.map((z) => {
        const list = rows.filter((r) => r.zone === z.key);
        if (list.length === 0) return null;
        return (
          <section key={z.key} className="qzone">
            <h2>{z.title} · {list.length}</h2>
            <p className="src">{z.hint}</p>
            {list.map(({ q, b, line }) => (
              <div key={q.id} className="qrow">
                <div className="who">
                  <b><Link href={`/cotizaciones/${q.id}`}>{q.deal.account.name}</Link></b>
                  <span className="src">{q.deal.title} · Nº {quoteNo(q)}</span>
                </div>
                <div>
                  <span>{line}</span>
                  <div className="chips">
                    {b.clocks.filter((c) => c.kind !== "offer").map((c) => <span key={c.key} className={`qv-chip ${c.kind}`}>{c.kind === "customer" ? c.label : c.kind === "supplier" ? t("Vigencia proveedor", "Supplier validity") : t("Promesa", "Promise")} · {i.weekday(c.at)} {i.day(c.at)}</span>)}
                  </div>
                </div>
                <span className={`sig ${q.status === "DRAFT" ? "dash" : "info"}`}>{q.status === "DRAFT" ? t("Borrador", "Draft") : t(`Presentada ${i.day(q.presentedAt)}`, `Presented ${i.day(q.presentedAt)}`)}</span>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
